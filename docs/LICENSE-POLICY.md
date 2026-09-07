# Dependency License Policy

**Why this is the hardest constraint in the project.** Two separate goals depend on it:

1. **Commercialization.** You intend to sell this to firms. A single GPL/AGPL component linked into the product can obligate you to release your source. A single BSL/SSPL component can forbid you from offering it as a service — which is exactly your business model.
2. **A clean IP story.** Patentability and licensing are *different questions* — using GPL code does not make an invention unpatentable. But a clean, permissively-licensed codebase means the invention is unambiguously **yours to assign**, with no upstream copyleft obligations, no third-party patent grants entangling your claims, and no due-diligence landmines when a firm's counsel reviews you. That is the real reason to be strict.

**Verify before you trust.** Licenses change (Redis, MinIO, Grafana, HashiCorp, Elastic all re-licensed in recent years). The `license-auditor` agent re-checks the actual `LICENSE` file of every pinned version at every gate. Do not trust this table, or your memory, over the file on disk.

---

## ALLOWLIST — permitted SPDX identifiers

`MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `PostgreSQL`, `Unlicense`, `CC0-1.0`, `Zlib`, `OFL-1.1` (fonts only), `PSF-2.0` (the CPython runtime itself — distinct from the MIT-licensed frameworks built on it, e.g. FastAPI/Pydantic/SQLAlchemy), `MPL-2.0` (**file-level copyleft — permitted only for unmodified, separately-distributed components such as OpenTofu; never vendored into our source tree**).

Anything not on this list requires an explicit written exception from the maintainer, recorded in `docs/LICENSE-EXCEPTIONS.md`.

## DENYLIST — do not add, do not vendor, do not link

### Copyleft
| Component | License | Consequence |
|---|---|---|
| Wazuh | GPL-2.0 | Copyleft on derivative works |
| Suricata | GPL-2.0 | Copyleft |
| Velociraptor | AGPL-3.0 | **Network copyleft — triggers on SaaS** |
| MinIO | AGPL-3.0 | Network copyleft; use S3 API + SeaweedFS instead |
| Grafana ≥ 8.0, Loki, Tempo | AGPL-3.0 | Network copyleft; use Prometheus + Perses |
| Neo4j Community | GPL-3.0 | Copyleft; model the graph in Postgres/ClickHouse |
| Ghostscript, most `*-GPL` codecs | GPL/AGPL | Copyleft |

### Source-available (not open source; usually forbids your exact business model)
| Component | License | Substitute |
|---|---|---|
| Elasticsearch, Kibana | Elastic-2.0 / SSPL | OpenSearch (Apache-2.0) or ClickHouse |
| MongoDB | SSPL | PostgreSQL |
| Redis ≥ 7.4 | RSALv2 / SSPL | **Valkey** (BSD-3-Clause) |
| Redpanda | BSL | NATS JetStream / Apache Kafka |
| TimescaleDB (community) | TSL | ClickHouse |
| Terraform ≥ 1.6, Vault ≥ 1.15, Consul | BSL | **OpenTofu** (MPL-2.0), OpenBao |
| Sentry (self-hosted) | BSL/FSL | OpenTelemetry + own error sink |
| n8n | Sustainable Use License | Temporal (MIT) |
| Cockroach, Materialize, and similar BSL DBs | BSL | PostgreSQL / ClickHouse |

### Proprietary / EULA-restricted
| Component | Problem |
|---|---|
| **Sysmon** | Microsoft EULA. Free to *use*, but redistribution and bundling into a commercial product are restricted, and you cannot make it a required dependency of a product you sell. **Build your own ETW-based Windows sensor.** This is also better for your IP story: your sensor becomes your asset. |
| AG Grid Enterprise, Highcharts, FusionCharts | Commercial licence required, watermarks in trial builds |
| Font Awesome Pro, any non-OFL font | Commercial licence |
| Nessus / Qualys / commercial scanner SDKs | Commercial |

### Detection content and models — the two traps people miss
| Component | License | Problem |
|---|---|---|
| **SigmaHQ rules** | DRL-1.1 | Not OSI-approved, **no patent grant**, and requires attribution *inside match-based output messages*. That means your product's alerts would have to carry third-party attribution text — a direct conflict with your no-watermark rule, and an awkward dependency for a patent story. **Write your own rule language (CDL) and your own rules.** |
| **Llama 3.x weights** | Meta Llama Community License | Bespoke, not OSI; acceptable-use policy, naming obligations, 700M-MAU clause. Do not ship as a default. |
| **Gemma weights** | Gemma Terms of Use | Bespoke use restrictions. Do not ship as a default. |
| Mistral models under MRL | Research-only | Check *per model* — Mistral 7B and Mixtral are Apache-2.0; some newer models are not. |

**Permitted default weights:** Qwen (Apache-2.0), Mistral 7B / Mixtral 8x7B (Apache-2.0), Phi (MIT), OLMo (Apache-2.0). Verify the specific checkpoint's card at pin time.

---

## Special cases — permitted with conditions

| Component | License | Condition |
|---|---|---|
| **MITRE ATT&CK** | MITRE grants a non-exclusive, royalty-free licence for research, development, and **commercial** use | Must reproduce: `© 2026 The MITRE Corporation. This work is reproduced and distributed with the permission of The MITRE Corporation.` in `THIRD-PARTY-NOTICES.md` and anywhere the matrix is redistributed. Use the ATT&CK *name* per MITRE's trademark guidance — describe as "mapped to MITRE ATT&CK®", never imply endorsement or certification. |
| **OCSF schema** | Apache-2.0 | Use as the normalization target. Safe. Preferred over ECS for vendor-neutrality. |
| **Zeek** | BSD-3-Clause | Permitted. Optional network sensor. Keep it as a separate process, not linked. |
| **osquery** | Apache-2.0 (dual-licensed; elect Apache-2.0 explicitly and record the election) | Permitted, optional. |
| **Falco** | Apache-2.0 | Permitted, but prefer your own eBPF sensor for IP reasons. |
| **Atomic Red Team** | MIT | Permitted **for test fixtures only**. Never shipped in the product. |
| **OpenTofu** | MPL-2.0 | Permitted as a separately-distributed binary. Never vendor MPL source into our tree. |

---

## Enforcement

The `license-auditor` agent runs at every phase gate and must produce a clean report:

```bash
# Python
pip install pip-licenses && pip-licenses --format=json --with-urls > .audit/py-licenses.json
# JS/TS
npx license-checker-rseidelsohn --json --production > .audit/js-licenses.json
# Go
go install github.com/google/go-licenses@latest && go-licenses report ./... > .audit/go-licenses.csv
# Rust
cargo install cargo-deny && cargo deny check licenses
# Whole-repo SBOM + scan
syft . -o spdx-json > .audit/sbom.spdx.json
```

`deny.toml`, `.licenserc.yaml`, and a CI job must **fail the build** on any SPDX identifier outside the allowlist. Ship a generated `THIRD-PARTY-NOTICES.md` — this is the one form of attribution that is mandatory, and it satisfies Apache-2.0 §4 and BSD/MIT notice requirements. It is a shipped file, not UI chrome.

**Also record:** for every dependency, its *patent grant* status. Apache-2.0 §3 includes an express patent licence with a termination clause on patent litigation; MIT and BSD have none. Your attorney will ask.
