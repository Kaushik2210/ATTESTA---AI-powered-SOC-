# Phase 2 — Collection and OCSF normalization

**Status: gate passed**, after fixing one genuine concurrency bug the test suite itself caught. See run history below.

## Scope decision — read this first

Phase 2's full spec (`phases/PHASES.md`, `docs/ARCHITECTURE.md` §2.1) calls for a Go endpoint agent with real Windows ETW consumer sessions and Linux eBPF programs, cloud connectors polling live AWS/Azure APIs via Temporal workflows, and OTel Collector/Fluent Bit intake. None of that is buildable or testable in this environment: no Linux kernel with root/BPF access, no Windows kernel-level ETW access, no cloud credentials, no Temporal server, no Docker. This was flagged as a risk in the pre-Phase-0 Build Plan (`phases/reports/BUILD-PLAN.md`, disagreement #2 and risk #3) before any code was written.

Scoped to what the gate's text actually requires and what's genuinely provable here:

1. **"replay a recorded pcap/log corpus through the pipeline twice; byte-identical evidence sets"** — the declarative OCSF mapping pipeline (`ingest/`), tested against two representative sources.
2. **"Agent survives a 10× burst with bounded memory and zero loss (backpressure test)"** — the agent's OS-agnostic buffering core (`agent/`), tested directly.
3. **"Mapping-version change produces new nodes, never mutations"** — tested at the ingest layer.

Deferred, not silently dropped: real ETW/eBPF/Endpoint-Security kernel capture, live Temporal-orchestrated cloud polling, and OTel Collector/Fluent Bit wiring. Each needs infrastructure this environment doesn't have; each is named explicitly below and in code comments so it isn't mistaken for "done."

## What was built

### `ingest/` — declarative OCSF mapping pipeline

- **`mapping.go`** — `Mapping`, loaded from `mappings/*.ocsf.yaml`: a `source_id`/`mapping_version`/`schema_version` envelope plus a `fields` map of target-path → source-path derivations, with optional type coercion (`int`, `timestamp_ns`) and `unmapped_passthrough` for anything not explicitly mapped. This is the mechanism `docs/ARCHITECTURE.md` §2.2 describes: the mapping version participates in every event's hash, so a mapping change produces a new node, never a mutation of history.
- **`mappings/cloudtrail.ocsf.yaml`** and **`mappings/entra_signin.ocsf.yaml`** — two representative, real mappings (AWS CloudTrail, Entra ID sign-in logs), not a full OCSF class registry — modeling every OCSF event class is later, incremental work that doesn't change how this pipeline behaves.
- **`pipeline.go`** — `ReplayCorpus`, feeding a JSONL corpus through a mapping into a `ledger.Store`.
- **Known limitation, documented in `mapping.go`:** unmapped-field tracking is top-level only. If a mapping consumes even one sub-field of a raw top-level object, the *whole* object is considered consumed and its other sub-fields never reach `unmapped` — silently dropped rather than hashed. This understates `docs/ARCHITECTURE.md`'s "unknown/vendor fields preserved under unmapped" guarantee for partially-mapped nested objects. Workaround today: map every sub-field of any object a mapping touches at all. Real fix (path-level consumption tracking) is deferred as a refinement, not a blocker.

### `agent/` — the endpoint sensor's OS-agnostic core

- **`buffer.go`** — `BoundedBuffer`: a fixed-capacity in-memory FIFO backed by a disk overflow queue. `Push` never blocks and never drops an event — once memory is full it spills to disk instead, staying committed to the disk path until the backlog is fully drained (never alternating per-event, which would reorder events).
- **`source.go`** — the `Source` interface real ETW/eBPF/Endpoint-Security collectors will implement later, defined now against the buffer this phase actually built and tested.

### `ledger/`

- **`store.go`** — added `Store.Len()`, a small additive helper the ingest replay tests need to confirm re-ingesting unchanged input adds no new nodes.

### CI

Broadened the existing `ledger-tests` job (renamed to reflect the new scope) to `go test ./... -race` across both matrix architectures, covering `ledger`, `ingest`, and `agent` together. `-race` specifically because `agent`'s buffer is genuinely concurrent code — see below.

## Gate: replay twice → byte-identical; 10× burst → bounded memory, zero loss; mapping-version change → new node, not mutation

Confirmed in CI: [run `34139483428`](https://github.com/Kaushik2210/ATTESTA---AI-powered-SOC-/actions/runs/34139483428), all four jobs green on `ubuntu-latest` and `macos-latest`.

- `TestReplayCorpus_ByteIdenticalAcrossTwoRuns` — both corpora (CloudTrail, Entra sign-in), replayed into two independent stores, produce identical `EvidenceID` sequences.
- `TestReplayCorpus_ReingestIntoSameStoreAddsNoNewNodes` — re-ingesting the identical corpus into the same store leaves its size unchanged.
- `TestMappingVersionChange_ProducesNewNodeNotMutation` — the same raw event through a mapping-version-bumped mapping produces a distinct `EvidenceID`; both the old and new nodes remain independently retrievable afterward.
- `TestBoundedBuffer_BurstZeroLossInOrder` — 500 events pushed synchronously against a 50-event capacity (a 10× burst, nothing draining): the in-memory queue never exceeded its bound, the disk-spill path was genuinely exercised (450 spilled events), and draining afterward recovered all 500 events in exact original order.
- `TestBoundedBuffer_ConcurrentProducerConsumer` — the same property under real concurrency (producer bursting while a consumer drains simultaneously) — see the bug this caught, below.

## A real concurrency bug the test suite caught

The first CI run failed `TestBoundedBuffer_ConcurrentProducerConsumer` on **both** architectures with an ordering violation (e.g. "got sequence 70, want 69").

**Root cause:** `Push` released the buffer's lock between setting `spilling = true` and appending the just-written file's path to the spill queue (the disk-write itself happened outside the lock, for concurrency). `Next()` could observe that gap — `spilling` already true, but the queue still reflecting only *earlier* spilled entries — pop the last of those, see the queue empty, and reset `spilling = false` before the in-flight `Push` had committed its own entry. A subsequent `Push` for a *later* event would then see `spilling == false` and go straight to memory, getting delivered ahead of the still-in-flight earlier event once it finally landed on disk.

**Fix:** hold the lock for `Push`'s entire duration, including the disk write, making every state transition atomic. This is consistent with the type's documented single-producer lifecycle (one agent process owns its own buffer), so it costs no real concurrency — the write was already effectively serialized by having one producer goroutine.

This is exactly why `TestBoundedBuffer_ConcurrentProducerConsumer` was written as a second, genuinely-concurrent test alongside the sequential burst test: the sequential test could not have caught this, since it never calls `Next()` while a `Push` is in flight.

## Deviations from spec, with justification

1. **No real kernel-level collectors** (ETW/eBPF/Endpoint Security) — see "Scope decision" above.
2. **No live cloud connectors.** The OCSF *mapping* logic for CloudTrail and Entra sign-ins is real and tested; the Temporal-orchestrated live-polling layer around it (checkpointed cursors, idempotent replay against actual AWS/Azure APIs) needs a Temporal server and real credentials, neither available here.
3. **No OTel Collector / Fluent Bit config.** Deferred rather than written-but-untested: there's no ingest HTTP endpoint yet for either to point at (that's `services/api`, much later), so a config file today would be speculative rather than real.
4. **Unmapped-field tracking is top-level only** — documented above and in `mapping.go`'s doc comment.

## `license-auditor` note

One new Go dependency: `gopkg.in/yaml.v3` (MIT AND Apache-2.0 dual-licensed, both already on the allowlist). No new Rust, Python, or JS dependencies this phase.

## Next

Waiting for approval before Phase 3 (CDL compiler and detection engine).
