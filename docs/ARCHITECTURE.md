# ATTESTA Architecture

## 0. The problem this architecture exists to solve

Every agentic-SOC product on the market today has the same structural defect: **the verdict is an artifact of a transcript, not a proof.** An LLM read some logs, wrote some prose, and a severity came out. Six months later, when a regulator, an insurer, a court, or an incoming CISO asks *"why did you close this benign?"*, all you have is a chat log — and re-running it produces a different answer, because the model changed, the retrieval corpus changed, and the prompt changed.

Industry surveys of agentic SOC platforms consistently name this as the top unsolved gap: multi-agent systems emit one activity log per agent per incident, and composing them into a defensible narrative is a manual job. Governance maturity is the reason most of these products "demo full autonomy and ship supervised triage."

ATTESTA's architecture is a direct answer: **make the decision deterministic even though the reasoning is not.**

---

## 1. The core idea in one diagram

```
                 NON-DETERMINISTIC ZONE          │        DETERMINISTIC ZONE
                                                 │
 telemetry ──► normalize ──► Evidence Ledger ────┼──────────────┐
                              (Merkle DAG,       │              │
                               BLAKE3, epoch)    │              │
                                    │            │              │
                                    ▼            │              │
                          ┌──────────────────┐   │              │
                          │  Investigator    │   │              │
                          │  (LLM + tools)   │   │              │
                          │  reads evidence  │   │              │
                          └────────┬─────────┘   │              │
                                   │             │              │
                          emits ONLY typed       │              │
                          evidence-cited Claims  │              │
                                   │             │              │
                                   ▼             │              ▼
                        ╔══════════════════╗     │     ┌─────────────────┐
                        ║  CLAIM GATE      ║─────┼────►│  Adjudication   │
                        ║  schema + hash    ║    │     │  Kernel (pure)  │
                        ║  validation       ║    │     │  Rust → native  │
                        ║  reject if no     ║    │     │       + WASM    │
                        ║  evidence hash    ║    │     └────────┬────────┘
                        ╚══════════════════╝     │              │
                                                 │              ▼
                                                 │      Verdict + Manifest
                                                 │              │
                                                 │              ▼
                                                 │      Transparency Log
                                                 │      (hash-chained,
                                                 │       signed, append-only)
                                                 │              │
                                                 │              ▼
                                                 │      Retro-Verdict Drift
                                                 │      (re-adjudicate old
                                                 │       cases vs. new intel)
```

The LLM is powerful but epistemically untrusted. The kernel is dumb but epistemically load-bearing. That split is the whole invention.

---

## 2. Component specifications

### 2.1 Collection tier

**Own endpoint agent (Go).** Do not depend on Sysmon (EULA) or Wazuh (GPL).

- **Windows:** ETW consumer sessions on `Microsoft-Windows-Kernel-Process`, `-Kernel-Network`, `-DNS-Client`, `-Security-Auditing`, plus the Security event log. Captures process create with full command line and hashed image, network connect, DNS query, registry persistence keys, service install, scheduled task create, named-pipe create, remote thread create, module load.
- **Linux:** eBPF via `cilium/ebpf` (Apache-2.0). Tracepoints on `sched_process_exec`, `sys_enter_connect`, `sys_enter_ptrace`, `security_bprm_check`; kprobes for `tcp_connect`; plus auditd fallback where eBPF is unavailable.
- **macOS:** EndpointSecurity framework.
- Agent buffers to disk with a bounded ring, signs each batch with a per-agent key, and ships over mTLS. Backpressure is the agent's problem, never the collector's.

**Cloud and SaaS:** pull-based connectors for AWS CloudTrail/GuardDuty/VPC Flow, Azure Entra ID sign-ins + Activity, GCP Cloud Audit, Okta System Log, Google Workspace, M365 Unified Audit. Each connector is a Temporal workflow with checkpointed cursors and idempotent replay.

**Network:** NetFlow/IPFIX ingest, optional Zeek (BSD-3) sidecar for protocol logs. No Suricata.

### 2.2 Normalization — OCSF, and canonicalization

Target schema is **OCSF** (Apache-2.0). Every source has a declarative mapping (`mappings/*.ocsf.yaml`) compiled into a Go transform. Mappings are versioned; the mapping version participates in the evidence hash, so a mapping change produces new evidence nodes rather than silently mutating history.

**Canonicalization is the foundation of everything else.** Before hashing:
- deterministic CBOR encoding (RFC 8949 canonical form), map keys sorted by byte order
- all timestamps normalized to UTC nanoseconds since epoch, integer
- no floats anywhere in the canonical form (fixed-point where needed)
- unknown/vendor fields preserved under `unmapped` but included in the hash
- explicit `schema_version`, `mapping_version`, `source_id`

`evidence_id = BLAKE3(canonical_cbor(event))`. Identical events from replayed sources dedupe for free.

### 2.3 Evidence Ledger

- **Storage:** ClickHouse for the event lake (columnar, partitioned by `(tenant_id, toYYYYMMDD(ts))`, ordered by `(tenant_id, entity_id, ts)`). Evidence nodes and edges also mirrored into Postgres for graph traversal of investigation-scoped subgraphs.
- **Structure:** a Merkle DAG. Leaves are evidence nodes. Internal nodes are batch roots. Every 10 seconds (configurable) a **batch root** is sealed; every hour an **epoch root** commits all batch roots in that window. Epoch roots are signed (Ed25519, per-tenant key) and chained: `epoch_n.prev = hash(epoch_{n-1})`.
- **Inclusion proofs:** any evidence node can produce a Merkle inclusion proof against its epoch root in O(log n). This is what lets you prove to a third party that a specific log line existed at a specific time and has not been altered.
- **Retention vs. proof:** raw payloads may age out to cold object storage or be deleted for GDPR/DPDP erasure, **but the hashes and the Merkle structure never are.** A deleted node's hash remains, marked `redacted`, so the chain stays verifiable and replay reports "evidence unavailable" honestly rather than silently changing the answer.

### 2.4 Detection engine

See `docs/DETECTION-SPEC.md`. Summary: our own **CDL** (Correlation Definition Language) — a YAML rule schema compiled to (a) streaming operators for real-time, and (b) ClickHouse SQL for retro-hunt over history. The same rule text drives both, which is what makes retro-hunting trustworthy. No Sigma (DRL licensing).

Three detector classes:
1. **Deterministic rules** (CDL) — the auditable backbone.
2. **Statistical baselines** — per-entity, per-hour-of-week robust z-scores and rare-value detection, maintained as incrementally-updated sketches (HyperLogLog, Count-Min, t-digest). Deterministic given the baseline snapshot hash.
3. **Sequence models** — an ordered-event anomaly model over process ancestry and auth sequences. Scores are *claims*, never verdicts.

### 2.5 Correlation and entity risk

Alerts are grouped into **Cases** by an entity-and-time correlation pass: shared entity (user, host, IP, hash, session), temporal proximity with a decay window, and kill-chain adjacency (a Discovery alert following an Initial-Access alert on the same host binds tighter than two unrelated Discovery alerts).

Entity risk is a fusion score with **explicit, versioned weights** (`policy/risk-model.v*.yaml`), time decay, and kill-chain-position weighting. It is computed in the kernel, so it is reproducible. The 43-failed-logins example: failed auth alone decays fast and caps low; failed auth *followed by* a success from the same source, *followed by* an interpreter spawn, crosses the fusion threshold because the kill-chain adjacency multiplier applies. That behaviour is a rule you can read, not a model you have to trust.

### 2.6 The Investigator (non-deterministic zone)

A constrained agent loop. Its only outputs are typed Claims.

**Tools available to it** (each schema-validated, each logged with argument hash):
`fetch_evidence(query)`, `entity_profile(entity_id, window)`, `process_ancestry(pid_ref)`, `auth_history(principal, window)`, `net_context(ip)`, `intel_lookup(indicator)`, `asset_context(host_id)`, `prior_cases(entity_id)`, `attack_technique(id)`.

**Hard constraints:**
- Bounded tool budget per investigation (default 24 calls), bounded wall clock, bounded token spend. Exceeding any budget yields a partial claim set and an `INCOMPLETE` verdict, never a guess.
- **Prompt-injection containment (I2 in practice):** telemetry is never concatenated into a system prompt. Retrieved content is delivered inside a fenced, escaped `<evidence id="...">` envelope with a standing instruction that its contents are data. Even if injection succeeds and the model emits an attacker-chosen narrative, the narrative is not an input to the verdict — only schema-valid, hash-cited claims are — so the blast radius of a successful injection is "a misleading paragraph", not "a wrong verdict". This is why I2 is an invariant and not a preference.
- The model runs behind a **provider abstraction** (`InferenceProvider`) with adapters for vLLM (default, self-hosted), Ollama, Anthropic, OpenAI, Azure OpenAI, Bedrock. Air-gapped deployments set `provider: vllm` and no egress rule is opened. Every call records `{provider, model_id, weights_digest, decode_params, seed, prompt_template_hash}`.

**Multi-hypothesis discipline:** the investigator is required to instantiate at least two competing hypotheses (e.g. `H1: credential compromise`, `H2: authorized admin activity`) and to seek disconfirming evidence for the leading one before concluding. Hypotheses and their supporting/refuting claim sets are part of the claim set.

### 2.7 The Claim schema and gate

```
Claim {
  claim_id:        blake3(canonical(self without claim_id))
  predicate:       enum      # e.g. AUTH_FAILED_BURST, AUTH_SUCCEEDED_AFTER_FAILURES,
                             #      INTERPRETER_SPAWNED_BY, CONNECTED_TO_INDICATOR,
                             #      PERSISTENCE_INSTALLED, TRAVEL_IMPOSSIBLE, ...
  subject:         EntityRef
  object:          EntityRef | Literal | null
  interval:        [t_start, t_end]        # UTC ns
  evidence:        [evidence_id]            # NON-EMPTY, all must exist in pinned epoch
  extractor:       {kind: rule|stat|model|llm, id, version}
  observed_value:  fixed-point | null
  polarity:        SUPPORTS | REFUTES
  hypothesis_ref:  hypothesis_id | null
}
```

The **Claim Gate** rejects a claim if: evidence list is empty; any `evidence_id` is absent from the pinned epoch's Merkle tree; predicate is not in the versioned predicate registry; interval is outside the case window; or the claim's own hash does not verify. Rejections are logged as `ClaimRejected` events — an unusual spike in rejections is itself a detection signal (it can indicate injection attempts).

### 2.8 The Adjudication Kernel

A Rust crate, `attesta-kernel`, `#![no_std]`-friendly, with **zero I/O**.

```rust
pub fn adjudicate(
    claims: &ClaimSet,            // canonical, sorted by claim_id
    policy: &PolicyBundle,        // versioned, content-addressed
    kernel_version: Version,
) -> Verdict                       // total function; errors are Verdict variants
```

Internals: a weighted kill-chain DAG evaluation. Each predicate maps to one or more ATT&CK tactics with a weight and a confidence multiplier; adjacency edges between tactics carry chain multipliers; REFUTES-polarity claims subtract. Arithmetic is **fixed-point i64 with an explicitly documented evaluation order** — no floats, no HashMap iteration order dependence (BTreeMap only), no `SystemTime`.

Output:
```
Verdict { severity, confidence, disposition, attack_techniques[],
          contributing_claims[] (with per-claim attributed weight),
          policy_version, kernel_version, verdict_hash }
```

`contributing_claims` with attributed weights is what makes the UI explanation *derived* rather than *written*. The narrative panel renders this structure; the LLM's prose sits beside it, clearly labelled as commentary.

**Compiled to WASM.** The browser downloads the kernel and the claim set and independently recomputes `verdict_hash`. The Verdict Ledger screen shows a genuine client-side verification badge — not a server assertion of correctness, but the user's own machine agreeing. That is the demo that ends the meeting.

### 2.9 Investigation Manifest and Transparency Log

```
InvestigationManifest {
  investigation_id, tenant_id, case_id,
  epoch_root, epoch_id, index_snapshot_hash,
  claim_set_hash, claim_ids[],
  inference: { provider, model_id, weights_digest, decode_params, seed,
               prompt_template_hashes[], tool_versions{} },
  policy_version, kernel_version, attack_model_version,
  verdict, verdict_hash,
  budget_consumed, started_at, completed_at,
  prev_manifest_hash, manifest_hash, signature
}
```

Manifests are hash-chained per tenant and sealed into the same Merkle epoch structure as evidence. Export produces a self-contained bundle: manifest + claim set + evidence inclusion proofs + kernel WASM binary + policy bundle. A third party with that bundle and no access to your systems can verify the verdict. That is the "court-defensible" property, stated concretely.

### 2.10 Replay Executor — two modes

| Mode | Input | Guarantee | Cost |
|---|---|---|---|
| `replay --pin` | stored claim set + pinned policy/kernel versions | **Bit-identical verdict.** Always. This is the audit path. | microseconds — pure kernel evaluation |
| `replay --rederive` | pinned epoch, re-run claim extraction | claim-set *semantic* diff reported; extraction drift quantified | full investigation cost |

The two-mode split is the honest answer to a real problem: LLM inference is not bit-reproducible across hardware, batch sizes, or kernel versions even at temperature 0. Pretending otherwise would be a lie you would have to defend in court. ATTESTA does not need LLM determinism, because the LLM does not decide anything. `--pin` gives you a hard mathematical guarantee; `--rederive` gives you an honest measurement of how much the reasoning layer drifts.

### 2.11 Retro-Verdict Drift Detection (RVD) — the flagship

A scheduled workflow re-adjudicates historical manifests against **current** policy, current threat intel, and current kernel version:

```
for manifest in closed_investigations(window):
    new_claims = manifest.claims + intel_reevaluate(manifest.claims)   # deterministic enrichment
    new_verdict = adjudicate(new_claims, current_policy, current_kernel)
    if new_verdict.disposition != manifest.verdict.disposition:
        emit VerdictDrift(manifest, new_verdict, diff_explanation)
```

Concretely: a case closed BENIGN in March, whose claim set includes `CONNECTED_TO(45.61.x.x)`, automatically reopens in June when that IP appears in an intel feed — with the exact claim, the exact evidence hash, and the exact policy delta that flipped it. No re-ingestion, no re-running the LLM, no analyst re-reading anything. It costs a kernel evaluation per case, so you can run it across every case you have ever closed, nightly.

**This is the strongest thing in the system.** It converts an audit log — normally a pure cost — into a retroactive detection engine. It is only possible because verdicts are pure functions of a stable, content-addressed claim set. No transcript-based product can do it.

---

## 3. Multi-tenancy

- `tenant_id` on every row. PostgreSQL RLS policies bound to `current_setting('attesta.tenant_id')`, set per-connection from the validated JWT. ClickHouse row policies mirror it.
- Per-tenant DEK, wrapped by a KEK in the secret manager. Evidence payloads encrypted at rest per tenant.
- Per-tenant inference routing: a tenant may pin its own vLLM endpoint inside its own network, so telemetry never leaves its perimeter even in the SaaS deployment. This is the MSSP unlock — one control plane, per-tenant data residency.
- Noisy-neighbour control: per-tenant ingest quota, investigation concurrency cap, and token budget enforced in Temporal task queues.
- Isolation is tested adversarially every gate — see `agents/tenant-isolation-fuzzer.md`.

## 4. Response tier

Playbooks are declarative (`playbooks/*.yaml`), each action typed and reversible where possible: `disable_account`, `revoke_sessions`, `isolate_host`, `block_indicator`, `quarantine_file`, `reset_credential`, `open_ticket`.

Every action passes a **blast-radius evaluation** in the kernel before proposal: how many principals, hosts, and dependent services does this touch; is the target a domain controller, a build server, a CEO's laptop. The result is displayed *before* an analyst approves. Autonomous execution is off by default and requires a per-tenant, per-action-type policy grant.

## 5. Repository layout

```
attesta/
├── kernel/                 # Rust: pure adjudication kernel (native + wasm32)
├── ledger/                 # Go: canonicalization, hashing, Merkle, epoch sealing
├── agent/                  # Go: endpoint sensor (etw/, ebpf/, es/)
├── ingest/                 # Go: collectors, OCSF mappers, normalizer
├── services/
│   ├── api/                # FastAPI: control plane, OpenAPI source of truth
│   ├── detect/             # CDL compiler + streaming + retro-hunt
│   ├── investigate/        # agent loop, claim gate, provider abstraction
│   ├── adjudicate/         # kernel FFI binding, manifest sealing, transparency log
│   └── respond/            # playbooks, blast radius, connectors
├── policy/                 # versioned policy bundles, risk model, predicate registry
├── rules/                  # CDL rule packs (ours; no Sigma)
├── web/                    # Next.js console
├── deploy/                 # Helm, OpenTofu, docker-compose (dev)
├── eval/                   # benchmark harness for the paper
├── docs/
└── phases/
```
