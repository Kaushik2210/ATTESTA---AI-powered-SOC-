# ATTESTA

[![CI](https://github.com/Kaushik2210/ATTESTA---AI-powered-SOC-/actions/workflows/ci.yml/badge.svg)](https://github.com/Kaushik2210/ATTESTA---AI-powered-SOC-/actions/workflows/ci.yml)

**ATTESTA is a multi-tenant Autonomous Security Operations Center platform
built around one property: every verdict it produces is reproducible and
re-adjudicable.**

Existing agentic-SOC products generate an incident verdict by having a
language model read telemetry and write a conclusion. Re-running that
process later — after a model upgrade, a provider change, or a week of new
data — produces a different answer, because nothing about the decision was
ever pinned. The audit trail is a transcript, not a proof.

ATTESTA separates the two halves of an investigation:

- **A non-deterministic reasoning layer** — an LLM that reads evidence and
  proposes typed, evidence-cited *claims*, and nothing else.
- **A deterministic decision layer** — a pure Adjudication Kernel that turns
  an admitted claim set into a verdict, given a versioned policy and a
  versioned kernel. Same inputs, byte-identical output, always.

Because the evidence corpus is content-addressed and epoch-pinned, and the
kernel is a pure function, a verdict can be re-derived exactly months later
— and, critically, *re-adjudicated* against today's threat intelligence
without re-running inference. A case closed benign in March reopens
automatically in June when new intel makes one of its claims match. That
mechanism, **Retro-Verdict Drift Detection**, turns an audit log from a pure
cost center into a retroactive detection engine.

## Status

Pre-release. The project is being built in the phased sequence described in
[`phases/PHASES.md`](phases/PHASES.md), each phase gated by tests that would
fail if the phase's claimed property were absent. Current phase: **0 —
Foundation and license enforcement**. See [`phases/reports/`](phases/reports/)
for the record of what's been built and verified so far.

## Documentation

| Document | Covers |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Project constitution — the invariants every change is held to |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design and the deterministic investigation core |
| [`docs/LICENSE-POLICY.md`](docs/LICENSE-POLICY.md) | Dependency license allowlist / denylist |
| [`docs/DETECTION-SPEC.md`](docs/DETECTION-SPEC.md) | The correlation rule language and detection families |
| [`docs/UI-SPEC.md`](docs/UI-SPEC.md) | Console surfaces and design law |
| [`docs/EVALUATION.md`](docs/EVALUATION.md) | Benchmark protocol |
| [`phases/PHASES.md`](phases/PHASES.md) | Build phases and their exit gates |

## Repository layout

```
attesta/
├── kernel/        Rust — pure adjudication kernel (native + wasm32)
├── ledger/        Go  — canonicalization, hashing, Merkle epoch sealing
├── agent/         Go  — endpoint sensor (ETW / eBPF / Endpoint Security)
├── ingest/        Go  — collectors, OCSF normalization
├── services/       Python — API, detection, investigation, adjudication, response
├── policy/        versioned policy bundles, risk model, predicate registry
├── rules/         detection rule packs
├── web/           Next.js operator console
├── deploy/        Helm, OpenTofu, docker-compose (dev)
├── eval/          benchmark harness
├── docs/          architecture, specs, license policy
└── phases/        build phases and per-phase reports
```

## Local development

Requires Rust, Go, Python 3.12, Node 20, and Docker.

```bash
make bootstrap   # install toolchains/hooks
make dev-up      # start ClickHouse, PostgreSQL, NATS, Valkey, SeaweedFS
make audit       # license + SBOM gate (docs/LICENSE-POLICY.md)
```

## License

Proprietary. All rights reserved. Third-party components are used under
their own licenses — see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)
and [`docs/LICENSE-POLICY.md`](docs/LICENSE-POLICY.md).
