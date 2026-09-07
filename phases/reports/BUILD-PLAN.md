# ATTESTA — Build Plan (pre-Phase 0)

> Written per `00-MASTER-PROMPT.md` step 3, after reading `CLAUDE.md` and all documents in `docs/` and `phases/`. No code has been written. Phase 0 has not started.

## Repo layout

Adopting `docs/ARCHITECTURE.md` §5 as-is, plus the two directories the pack itself requires that aren't in that listing:

```
attesta/
├── .claude/agents/          # the 10 subagents from the pack (installed)
├── kernel/                  # Rust: pure adjudication kernel (native + wasm32)
├── ledger/                  # Go: canonicalization, hashing, Merkle, epoch sealing
├── agent/                   # Go: endpoint sensor (etw/, ebpf/, es/)
├── ingest/                  # Go: collectors, OCSF mappers, normalizer
├── services/
│   ├── api/                 # FastAPI control plane
│   ├── detect/               # CDL compiler + streaming + retro-hunt
│   ├── investigate/          # agent loop, claim gate, provider abstraction
│   ├── adjudicate/           # kernel FFI binding, manifest sealing, transparency log
│   └── respond/               # playbooks, blast radius, connectors
├── policy/                  # versioned policy bundles, risk model, predicate registry
├── rules/                   # CDL rule packs
├── web/                     # Next.js console
├── deploy/                  # Helm, OpenTofu, docker-compose (dev)
├── eval/                    # benchmark harness for the paper
├── docs/
└── phases/reports/
```

`deny.toml`, `.licenserc.yaml`, `THIRD-PARTY-NOTICES.md`, `.env.example`, and CI workflow files land at repo root as part of Phase 0 itself — not created yet.

## Phase 0 dependencies — proposed pins

To be verified by `license-auditor` against the actual `LICENSE` file of each pinned version before anything is added — per the pack's own rule ("never trust a table, or your memory, over the file on disk").

| Component | Proposed pin | SPDX (claimed) | Note |
|---|---|---|---|
| Rust toolchain | 1.82 (`rust-toolchain.toml`) | MIT OR Apache-2.0 | for `kernel/`, pinned now even though built in Phase 5 |
| Go toolchain | 1.23.x | BSD-3-Clause | |
| Python | 3.12.x | **PSF-2.0, not MIT** | `CLAUDE.md`'s table mislabels this — see disagreement #1 |
| Node.js | 20 LTS | MIT | |
| ClickHouse server | 24.8 LTS | Apache-2.0 | event lake |
| PostgreSQL | 16.x | PostgreSQL License | control plane DB |
| NATS Server (JetStream) | 2.10.x | Apache-2.0 | bus |
| Valkey | 8.0.x | BSD-3-Clause | not Redis ≥7.4 |
| SeaweedFS | 3.x | Apache-2.0 | local-dev S3-compatible object store |
| cargo-deny | 0.16.x | MIT OR Apache-2.0 | license/SBOM gate, Rust |
| pip-licenses | 5.x | MIT | license report, Python |
| license-checker-rseidelsohn | 4.x | BSD-3-Clause | license report, JS/TS |
| go-licenses | latest tagged | Apache-2.0 | license report, Go |
| syft | 1.x | Apache-2.0 | whole-repo SBOM |
| pre-commit | 4.x | MIT | hook runner |

## Three architectural risks most likely to sink this

1. **Scope inflation with no forcing function to catch it.** Thirteen phases spanning a custom multi-OS EDR sensor, a bespoke correlation language with dual compilation, a from-scratch pure kernel proven deterministic across two architectures and native+WASM, a full agentic investigator with injection containment, a Merkle transparency log, a retro-adjudication scheduler, and a dense custom WebGL console — each phase gate only checks that *phase's* property, not whether the project as a whole is still on a plan a solo builder can finish. Track actual time-per-phase from Phase 0 onward and force an explicit re-scope conversation if early phases run materially over.
2. **Determinism is a property of the whole dependency tree, not a phase-5 deliverable.** Once `determinism-verifier` passes at Phase 5/7, it's easy to assume the guarantee holds forever. A single dependency bump anywhere in `kernel/`'s transitive tree that introduces `HashMap` iteration, a float, or a clock read would silently break the patent's central claim with no visible symptom until a `--pin` replay drifts — possibly discovered by a customer or examiner rather than CI. `determinism-verifier` needs to be a **mandatory pre-merge check on every PR touching `kernel/`**, not just a phase-gate ritual.
3. **The custom endpoint sensor (Phase 2) is a full EDR engineering effort orthogonal to the patentable core.** Building ETW + eBPF + Endpoint Security framework collectors from scratch, correctly, with backpressure and signing, is a multi-month undertaking on its own — and none of it is claimed in the patent scaffold (`docs/NOVELTY-AND-PATENT.md` §3), which is entirely about the claim-gate/kernel/manifest/RVD chain. Sinking effort here before Phases 5–8 are proven risks spending months on infrastructure that contributes nothing to the invention or the paper if the schedule runs out.

## Where the docs look wrong, or worth pushing back on

1. **`CLAUDE.md` §3's tech table lists Python 3.12 as SPDX `MIT`.** Incorrect — CPython is licensed under **PSF-2.0**, not MIT. PSF-2.0 is permissive and in the same spirit as the rest of the allowlist, but it isn't literally on the allowlist in `docs/LICENSE-POLICY.md` either. Recommend explicitly adding `PSF-2.0` to the allowlist rather than leaving the mislabel — otherwise `license-auditor` resolving Python's *actual* license text would flag its own language runtime as a violation.
2. **Phase 2's scope (three full OS sensors) is heavier than the Phase 2 gate actually requires.** The gate in `phases/PHASES.md` only requires replaying a recorded corpus twice for byte-identical evidence and surviving a burst test — it does not require Windows/macOS sensors to exist yet. Suggest Linux eBPF + a dataset-replay ingestion path is sufficient to pass Phase 2 and unblock Phases 3–8 (the patentable core), with Windows ETW and macOS ES sensors deferred to run in parallel with or after Phase 8 rather than gating it. The phase *ordering* (kernel/claim-gate/RVD at 5–8, before the heavy UI at 9–11) is already right — it's the *breadth* expected within Phase 2 specifically that's worth trimming.
3. **No mechanism is specified for concurrent/overlapping epoch sealing.** `docs/ARCHITECTURE.md` §2.3 describes 10-second batch roots sealed into hourly epoch roots per tenant, but doesn't address what happens to evidence still arriving when an epoch boundary is crossed. Worth a decision before Phase 1 so replay semantics near epoch boundaries are unambiguous.

---

**Status: stopped per instruction.** Waiting on approval before Phase 0 begins.
