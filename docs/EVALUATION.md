# Evaluation Protocol — the numbers the paper needs

The paper's contribution is not "we built an AI SOC." It is a measured claim about decision reproducibility. Design the evaluation to produce numbers that support that claim and would embarrass you if they were wrong.

## E1 — The reproducibility gap (the motivating result)

Establish that the problem is real before claiming to solve it.

Run the same 200 investigations through a **transcript-style baseline** (LLM reads evidence, writes verdict directly — i.e. how current products work), repeated under: same model 10×, model version upgraded, different provider, retrieval corpus grown by one week.

Report: disposition variance rate, severity variance, and technique-set Jaccard distance across runs.

Then run the same 200 through ATTESTA and report the same metrics. Expected: baseline drifts materially; ATTESTA's `--pin` disposition variance is exactly 0.0000 by construction, and `--rederive` variance is reported honestly as the claim-extraction drift it is.

**Do not hide the `--rederive` drift.** It is a real property of the system and reporting it is what makes the `--pin` result credible.

## E2 — Detection efficacy

| Metric | How |
|---|---|
| TPR / FPR per detection family | Attack corpora from `adversary-emulator` against a 10,000:1 benign corpus |
| Precision at the case level | After correlation and adjudication, not per-alert — per-alert precision flatters every SIEM |
| MTTD | Ingest timestamp → case reaching CRITICAL |
| Alert reduction ratio | Raw detector fires → adjudicated cases |
| ATT&CK coverage | Techniques with a rule / with a fire / with supporting telemetry — three separate numbers |

## E3 — Retro-Verdict Drift (the headline)

The result nobody else can report.

Protocol: ingest a corpus with a temporal cut at date T. Adjudicate all cases using only intel available at T. Then advance the indicator corpus to T+90d and run the RVD sweep.

Report:
- **flip rate** — % of cases closed benign at T that adjudicate malicious at T+90d
- **true-flip rate** — of those, how many are genuine (ground truth from the corpus construction)
- **lead time recovered** — days between the original close and the flip
- **cost** — cases/sec/core, and total compute to re-adjudicate the full history
- **comparison** — the compute to achieve the same result by re-running investigations (this ratio is your technical-effect number for the patent)

A result of the shape *"X% of benign-closed cases were retroactively confirmed malicious within 90 days, recovered at N cases/sec/core with zero inference cost"* is publishable on its own.

## E4 — Adversarial robustness

- **Prompt injection:** N payload variants embedded in log fields. Report verdict-change rate. Target: 0. Also report claim-rejection rate, which shows the gate working rather than luck.
- **Evasion:** obfuscated command lines, timing-spread attacks, living-off-the-land binaries. Report detection degradation.
- **Ledger tampering:** attempt to alter, backdate, or reorder evidence. Report detection rate. Target: 100%, since it is cryptographic.

## E5 — Performance

Kernel latency distribution, ingest throughput, replay-versus-reinvestigation ratio, evidence dedup ratio, Merkle proof cost versus full re-scan, UI frame rates. Hardware and methodology stated for every number.

## Datasets

**Verify each dataset's licence and redistribution terms before publication** — several widely-used security datasets have citation or non-commercial conditions, and a reviewer will check. Record the terms in `docs/PRIOR-ART.md`.

Candidates to evaluate: DARPA OpTC, LANL comprehensive multi-source cyber-security events, CIC-IDS2017 / CSE-CIC-IDS2018, UNSW-NB15, and Splunk BOTS. Supplement with `adversary-emulator` synthetic corpora, which are the only way to get ground truth for E3's temporal-cut protocol — public datasets lack the intel-timeline you need.

## Reproducibility of the paper itself

Ship `eval/run.py` producing every table from a single command against a pinned corpus digest. Publish corpus hashes, policy bundle hashes, and kernel version. It would be a poor look to publish a paper about reproducibility with an irreproducible evaluation.

## Baselines to compare against

Be fair. Compare against a transcript-style LLM baseline you implement yourself (not a competitor's product, which would raise ToS and benchmarking-clause problems), a rules-only SIEM baseline, and a rules-plus-statistics baseline. State clearly that the comparison is against reimplemented approaches, not shipped commercial products.
