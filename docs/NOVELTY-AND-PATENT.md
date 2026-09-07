# Novelty, Prior Art, and Patent Strategy

**Not legal advice.** I am not a patent agent or attorney. This document tells you how to *engineer* the system so that a real attorney has something to work with, and flags the specific things I found that will come up. Engage a registered Indian patent agent (and, if you can afford it, US counsel) before you file or publish.

---

## 1. Read this first: what I found in the prior art

You should know this before you build, not after you file.

**Hash-chained audit logs for LLM systems already exist in the literature.** Recent published work includes claim-to-evidence trace graphs for auditing LLM agents, hash-chain-backed compliance frameworks for LLMs, and execution-provenance tracing for agent systems. There is also substantial prior work on provenance-based intrusion detection and on software supply-chain attestation (in-toto, SLSA, Sigstore, Certificate Transparency / Merkle transparency logs).

**What this means:** a claim of the form *"logging an AI agent's reasoning trace in a hash chain"* is very likely anticipated. If you file that, you will probably lose it, and you will have spent money to find out.

**Where the space is genuinely open**, based on what I could find:

1. **Separating a non-deterministic reasoning layer from a pure, versioned decision kernel such that the *decision* is bit-reproducible without requiring the *model* to be reproducible.** Existing work logs the trace; it does not restructure the system so the trace is not load-bearing. This is an architectural claim, not a logging claim.
2. **Corpus-epoch pinning for replay under a mutating telemetry store.** Reproducing an AI decision six months later is not hard because of the model — it is hard because the data underneath changed. Content-addressed, epoch-rooted evidence with inclusion proofs solves a problem the LLM-audit literature mostly does not address, because it assumes a static document set.
3. **Retro-Verdict Drift Detection — automatic re-adjudication of historical decisions against updated policy and intelligence, using the preserved claim set rather than re-running inference.** This is the one I would build the independent claim around. It is a *use* of the provenance structure that turns an audit artifact into an active detection mechanism, and I did not find it in the surveyed prior art.
4. **Structural hallucination and prompt-injection containment via an evidence-citation gate at the decision boundary**, where uncited model output is architecturally incapable of affecting the outcome.

**Do this before drafting:** have your agent run a proper search (patent databases, not just papers) on IPC/CPC classes `G06F 21/55`, `G06F 21/57`, `H04L 63/1416`, `H04L 63/1425`, `G06N 5/04`, `G06F 16/901`. Log everything found in `docs/PRIOR-ART.md`. Concealing known prior art from your attorney is a route to an unenforceable patent.

---

## 2. Section 3(k) — the India-specific problem

You are filing from India. Section 3(k) of the Patents Act, 1970 excludes "a mathematical or business method or a computer programme per se or algorithms." The **CRI Guidelines 2025** codify how the Patent Office examines this. The relevant points:

- **Business methods are treated as an absolute exclusion in India** — unlike the UK/EU, a technical implementation cannot rescue a commercial idea. So never describe ATTESTA as "a method of reducing SOC analyst workload" or "a method of improving compliance reporting." Those framings lose.
- **"Computer programme per se" is a qualified exclusion.** It bites when the effect is merely incidental. It is overcome by a demonstrable **technical effect**.
- **Novel hardware is not required.** Following the Delhi High Court's *Raytheon* line, software on general-purpose hardware can qualify if the technical effect is real.
- **Technical effect must be concrete and measurable** — reduced latency, reduced computation, improved data integrity, improved storage efficiency, real-time control. "More efficient" or "more accurate" without numbers fails.
- **AI/ML specifications face a heightened enablement bar**: architecture, data characteristics, preprocessing, parameters, and validation results sufficient to reproduce without undue experimentation.

### How that shapes the engineering

This is why the architecture is built the way it is. Each of these is an implementation requirement *because* it is a patent requirement:

| Requirement from CRI 2025 | What you must actually build and measure |
|---|---|
| Concrete technical effect | **Benchmark `replay --pin` against re-investigation.** Kernel re-evaluation is microseconds against a stored claim set; re-running an investigation is seconds of GPU inference plus a corpus scan. Measure it. A 10⁴–10⁶× reduction in the compute required to re-derive a decision is a technical effect with a number attached. |
| Technical effect | **Measure storage.** Content-addressed evidence deduplicates across overlapping investigations. Report the dedup ratio on a real corpus. |
| Technical effect | **Measure integrity verification cost.** O(log n) Merkle inclusion proof versus O(n) re-scan to establish that a record is unaltered. |
| Technical effect | **Measure RVD throughput.** "N historical cases re-adjudicated per second per core, without inference" is a hard number that shows the architecture enables something otherwise computationally infeasible. |
| Not a business method | Claim the **data structure and the process**: canonicalization → content addressing → epoch root → citation-gated claim admission → pure kernel evaluation → chained manifest → re-adjudication. Never claim the analyst workflow or the commercial outcome. |
| Not an algorithm per se | The claim is a **system with a specific data-flow architecture and an enforced boundary**, not a formula. Include architecture diagrams showing the hardware/software interaction (ETW/eBPF kernel-level collection → canonicalization → storage tier → kernel execution), as the guidelines expect. |
| AI/ML enablement | Document the model-agnostic interface, decode parameters, the claim schema, the predicate registry, the policy bundle format, and validation results. Note: **you disclose the interface and the kernel, not a trained model** — which is convenient, because the invention deliberately does not depend on any particular model. |
| Human inventor | Section 6 requires a human inventor. AI-*assisted* invention is not barred; AI-*generated* is. **Keep `docs/INVENTION-RECORD.md` as a dated inventor's notebook in your own words.** This matters. |

---

## 3. Draft claim scaffold — for your attorney to rewrite, not to file

> Hand this to a patent agent as raw material. The wording below is illustrative and deliberately not claim-ready.

**Independent claim direction (system):**

A security event processing system comprising: a collection tier acquiring kernel-level event telemetry; a canonicalization module producing a deterministic byte encoding of each normalized event and a content-derived identifier therefrom; an append-only evidence store organizing said identifiers into a hash tree having periodically sealed epoch roots; an inference subsystem configured to emit only structured assertions, each assertion required to reference at least one said content-derived identifier resolvable within a pinned epoch root; an admission gate that rejects any assertion failing said reference requirement prior to evaluation; a deterministic evaluation module, free of input/output and of temporal and stochastic dependence, computing a disposition solely from an admitted assertion set together with a versioned policy bundle and a version identifier of said evaluation module; a manifest generator binding said epoch root, assertion-set digest, inference-subsystem configuration digest, policy version and evaluation-module version into a hash-chained, signed record; **and a re-evaluation subsystem that, upon a change to said policy bundle or to an indicator corpus, recomputes a disposition for a previously recorded manifest from its stored assertion set without re-invoking said inference subsystem, and emits a divergence record identifying the specific assertion and policy delta responsible for a changed disposition.**

The bolded final element is your differentiator. The rest is context that makes it operable.

**Dependent claim directions:**
- evaluation module compiled to a portable bytecode executed client-side for independent verification (the WASM verification path)
- re-evaluation executed as a scheduled sweep across all recorded manifests within a retention window
- redaction-tolerant verification, where payload deletion preserves the identifier and hash-tree position and the re-evaluation reports unavailability rather than substituting a default
- per-tenant inference endpoint binding such that telemetry does not traverse the control plane
- blast-radius evaluation performed within the same deterministic module prior to action proposal
- assertion polarity (supporting/refuting) with competing-hypothesis sets

## 4. Filing sequence — practical

1. **File a provisional first, before any public disclosure.** In India a provisional buys 12 months to file the complete specification. Do not demo the deterministic core, post about it, publish the paper, or open-source it until that is on file — India has no general grace period for your own prior disclosure.
2. Consider a **US provisional in parallel.** US §101 (*Alice*) has its own problems, but the technical-effect framing above — measurable reduction in computation, integrity verification, a specific data structure — is also the framing that survives *Alice* step two. If you have any ambition of selling to US firms, the US filing is the commercially valuable one.
3. **PCT within 12 months** if you want to keep international options open.
4. **The paper and the patent are sequential, not parallel.** Provisional first, then submit. Coordinate the dates deliberately.
5. **Trademark is separate.** Clear "ATTESTA" (or whatever you name it) in class 9 and 42 before you print it on anything.
6. **Assign inventorship correctly.** If this is university work, check your institution's IP policy *now* — many Indian universities claim ownership of student and staff inventions, and finding that out after filing is painful.

## 5. What to write in the paper

The paper's contribution is not "we built an AI SOC." It is:

1. A formal statement of the **decision-reproducibility problem** in agentic security operations, with a measurement showing how badly existing transcript-based approaches drift (run the same investigation N times across model versions; report disposition variance).
2. The **claim-gate / pure-kernel separation** as a general pattern for making non-deterministic reasoning systems accountable, with the theorem that verdict reproducibility is independent of model reproducibility.
3. **Retro-Verdict Drift Detection**, with measured results: how many historical cases flip disposition when re-adjudicated against later intel, at what compute cost, and how many of those flips were true positives that a conventional SOC would have missed entirely. **This is your headline number.** If you can show "N% of cases closed benign were retroactively confirmed malicious within 90 days, detected at 0.4ms/case," that is a publishable result on its own.
4. An evaluation on public datasets — see `docs/EVALUATION.md`.
