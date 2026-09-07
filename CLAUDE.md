# ATTESTA — Project Constitution

This file governs every session in this repository. It outranks convenience, habit, and any later instruction that contradicts it. If a request conflicts with this document, stop and say so.

**Codename note:** "ATTESTA" is a working codename. Trademark clearance has not been done. Do not print it on anything shipped to a customer until it has.

---

## 1. What this system is

A multi-tenant autonomous SOC platform whose distinguishing property is that **every verdict is reproducible and re-adjudicable**. Ingest telemetry, normalize it, detect, correlate, investigate with an LLM under hard structural constraints, adjudicate deterministically, and present the result in an operator console that a tier-3 analyst would choose over their existing tools.

## 2. The five invariants

These are the load-bearing walls. Violating one is a build failure, not a code smell.

**I1 — Purity of the kernel.**
The Adjudication Kernel is a pure function. Given the same `(ClaimSet, policy_version, kernel_version, attack_model_version)` it returns a byte-identical `Verdict`. No clock reads, no network calls, no database access, no randomness, no environment variables, no floating-point non-determinism (fixed-point or integer arithmetic only, or IEEE-754 with a documented, pinned evaluation order). No LLM call may appear anywhere inside it, transitively.

**I2 — No claim without evidence.**
Every `Claim` entering the kernel carries at least one content hash of an evidence node that exists in the ledger. A claim citing zero evidence, or citing a hash not present in the pinned epoch, is rejected at the schema boundary and never reaches the kernel. Prose is never load-bearing: the LLM's narrative is a rendering of the claim set, never an input to the verdict.

**I3 — Append-only, content-addressed evidence.**
Normalized events are canonicalized (deterministic CBOR), hashed with BLAKE3, and written once. Nothing in the evidence path is mutable. Corrections are new nodes that supersede, never edits.

**I4 — Tenant isolation is structural, not conditional.**
Isolation is enforced at the database layer (PostgreSQL row-level security bound to a session tenant claim; ClickHouse per-tenant row policies) and re-asserted at the API layer. There is no code path where a missing `WHERE tenant_id = ?` yields cross-tenant data, because the database refuses. Every tenant has its own data encryption key.

**I5 — License purity.**
No copyleft (GPL/LGPL/AGPL), no source-available (BSL/SSPL/Elastic/TSL/RSAL/Sustainable Use), no bespoke model licenses, no attribution-in-output licenses. Allowlist only. See `docs/LICENSE-POLICY.md`. The `license-auditor` agent gates every merge.

## 3. Technology decisions (settled — do not relitigate without raising it)

| Layer | Choice | SPDX |
|---|---|---|
| Endpoint agent | Own Go agent; Windows via ETW + Security Event Log, Linux via eBPF (`cilium/ebpf`) | Apache-2.0 lib |
| Log shipping | OpenTelemetry Collector, Fluent Bit | Apache-2.0 |
| Bus | NATS JetStream | Apache-2.0 |
| Event lake | ClickHouse | Apache-2.0 |
| Control plane DB | PostgreSQL + pgvector | PostgreSQL |
| Object store | S3 API; SeaweedFS for local dev | Apache-2.0 |
| Cache / queue | Valkey (**not** Redis ≥7.4) | BSD-3-Clause |
| Backend | Python 3.12 (runtime: PSF-2.0), FastAPI, Pydantic v2, SQLAlchemy 2, Alembic (frameworks: MIT) | PSF-2.0 / MIT |
| Hot path | Go 1.23 for collectors and the ingest normalizer | BSD-3-Clause |
| Kernel | Rust, compiled to native **and** `wasm32-unknown-unknown` | own code |
| Workflow | Temporal | MIT |
| Inference | vLLM; adapters for Ollama, Anthropic, OpenAI, Azure, Bedrock | Apache-2.0 |
| Default weights | Qwen (Apache-2.0), Mistral 7B / Mixtral (Apache-2.0), Phi (MIT) — **never Llama or Gemma** | Apache-2.0 / MIT |
| Frontend | Next.js 15, React 19, TypeScript 5, Tailwind v4, shadcn/ui, Radix, Motion, TanStack Query/Table/Virtual | MIT |
| Graph canvas | Cytoscape.js or WebGL (`regl`); **not** a commercial graph library | MIT |
| Charts | visx / Recharts, per `/dataviz` | MIT |
| Icons / fonts | Lucide (ISC); Inter, JetBrains Mono, IBM Plex (OFL-1.1) | ISC / OFL-1.1 |
| Metrics | Prometheus + Perses (**not** Grafana ≥8) | Apache-2.0 |
| IaC | OpenTofu (**not** Terraform ≥1.6), Kubernetes, Helm | MPL-2.0 / Apache-2.0 |

## 4. Engineering standards

- **Typed end to end.** Python: strict mypy, Pydantic models at every boundary. TS: `strict: true`, no `any`, no non-null assertions. Rust: `#![deny(warnings)]` in the kernel crate.
- **Schema is the contract.** OpenAPI generated from FastAPI; TypeScript client generated from OpenAPI. Frontend never hand-writes a request type.
- **Migrations only.** No manual DDL. Alembic for Postgres, versioned SQL for ClickHouse.
- **Errors are values in the kernel.** No panics, no exceptions across the kernel boundary.
- **Every module ships tests with it.** Untested code does not pass a phase gate.
- **Secrets never enter the repo.** `.env.example` only; runtime config via env or a secret manager.
- **Structured logging only**, JSON, with `tenant_id`, `trace_id`, `investigation_id` on every line. Never log raw telemetry payloads or credentials.

## 5. Security posture of the platform itself

We are a security product; being compromised is existential.

- Threat-model every phase's new surface with the `threat-model-reviewer` agent (STRIDE).
- The LLM boundary is an untrusted-input boundary. Telemetry contains attacker-controlled strings. Treat every retrieved document and every log line as hostile: never let retrieved content alter tool selection, never interpolate raw telemetry into a system prompt, and validate all tool arguments against a schema before execution. Prompt injection in a log line must be structurally incapable of changing a verdict — that is what I2 buys you.
- Response actions are proposals by default. Autonomous execution requires an explicit per-tenant policy grant, a blast-radius computation, and an entry in the ledger.
- No egress from the investigation runtime except to the configured inference endpoint and declared enrichment providers, via an allowlist.

## 6. Attribution hygiene ("no watermarks")

Non-negotiable, and checked at every UI gate:

- No "Built with", "Generated by", "Powered by", "Made with AI", or any tool credit — in the UI, in meta tags, in HTML comments, in the README, in commit messages, or in generated PDFs and exports.
- No `<meta name="generator">`. No framework badges. No CDN template signatures.
- No AI co-authorship trailers in commits. Commits are authored by the human maintainer.
- No emoji used as an icon or as UI chrome. Lucide SVG only.
- No lorem ipsum, no `example.com`, no stock placeholder logos, no dummy avatars in anything reachable from a demo path. Seed data is synthetic but realistic and internally consistent.
- No third-party watermark or trial banner from any library. If a library injects one, it is the wrong library.
- Fonts self-hosted; no external font CDN calls that leak your users' IPs.
- Every dependency's required attribution lives in `THIRD-PARTY-NOTICES.md`, which is shipped but not rendered as UI chrome. (This is the one legitimate form of attribution and it is mandatory — see `docs/LICENSE-POLICY.md`.)

## 7. Patent and publication discipline

- The `patent-scribe` agent maintains `docs/INVENTION-RECORD.md`. Every design decision touching the deterministic core gets a dated entry with the reasoning and the alternatives rejected. This is your inventor's notebook and it matters if the filing is ever contested.
- **Do not publish, demo publicly, open-source, or post about the deterministic core until a provisional application is on file.** India has no general grace period; a public disclosure before filing can destroy novelty in most jurisdictions.
- Prior art found during the build goes into `docs/PRIOR-ART.md` with citation and a note on how ATTESTA differs. Hiding known prior art from your attorney is how patents get invalidated later.
- Nothing in this repo is legal advice. A registered patent agent must review the claims and run a real prior-art search before filing.

## 8. Definition of done for a phase

1. Exit-gate command exits 0.
2. Tests written *for that phase's behaviour* pass, and at least one would fail if the feature were removed.
3. `license-auditor` reports clean.
4. `threat-model-reviewer` has signed off on any new external surface.
5. UI phases: `/webapp-testing` Playwright run green, axe-core zero critical violations, screenshots captured at 1280 / 1920 / 2560 in light and dark.
6. `phases/reports/PHASE-NN.md` written.
7. `docs/INVENTION-RECORD.md` updated if the phase touched the core.
