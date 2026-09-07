# Prior Art Log

> Every relevant paper, patent, product and project found during the build. Include prior art that is uncomfortably close. Concealing known prior art from counsel produces patents that fail when challenged — which is worse than not filing.

**Search classes to cover:** `G06F 21/55`, `G06F 21/57`, `H04L 63/1416`, `H04L 63/1425`, `G06N 5/04`, `G06F 16/901`.
**Search patent databases, not only papers.** Espacenet, Google Patents, USPTO full-text, and the Indian Patent Office search.

---

## Known at project start (found during architecture research, 2026-09)

| Ref | Type | What it covers | How ATTESTA differs |
|---|---|---|---|
| Claim-to-evidence trace graphs for auditing LLM agents (arXiv) | Paper | Tracing agent claims back to evidence | Trace is descriptive; the decision is still made by the model. ATTESTA makes the decision a pure function of the traced claims, so the trace is load-bearing rather than explanatory. |
| Hash-chain-backed auditable LLM frameworks (MDPI Electronics) | Paper | Tamper-evident logging of LLM interactions | Logs the transcript. Does not address corpus mutation, does not permit re-adjudication without re-inference. |
| Execution provenance / agent-trace-to-trust work (arXiv) | Paper | Provenance of agent execution | Same distinction as above. |
| in-toto, SLSA, Sigstore, Certificate Transparency | Standards/OSS | Supply-chain attestation, Merkle transparency logs | Attests *artifacts*; ATTESTA attests *decisions derived from mutable observational data*. Corpus-epoch pinning is the delta. |
| Provenance-based intrusion detection literature | Papers | System-provenance graphs for detection | Uses provenance to *detect*; ATTESTA uses it to make detection decisions reproducible and retroactively re-evaluable. |
| Commercial agentic-SOC platforms (see D3/UnderDefense 2026 surveys) | Products | LLM triage and investigation | Surveys identify per-agent activity logs and manual narrative composition as an open gap. None re-adjudicate closed cases against later intel without re-inference. |

## Found during build

_(append here — ref, date found, source, relevance, differentiation)_
