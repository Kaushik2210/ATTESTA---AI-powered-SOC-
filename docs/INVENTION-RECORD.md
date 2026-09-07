# Invention Record

> Inventor's notebook. Dated, factual, in the maintainer's own words. Maintained by the `patent-scribe` agent under the maintainer's direction. This may be read by a patent examiner or by opposing counsel — write it accordingly.

**Inventor(s):** _(name, affiliation, date of first conception)_
**Institution IP policy checked:** ☐ yes ☐ no — _(many Indian universities claim ownership of student and staff inventions; resolve this before filing)_
**Provisional filed:** ☐ no ☐ yes, on ______ , application no. ______

---

## Technical-effect ledger

CRI Guidelines 2025 require *quantified* technical effect. "More efficient" fails. Fill every row with a measured number and the hardware it was measured on.

| Effect | Measurement | Result | Date | Hardware |
|---|---|---|---|---|
| Re-derivation compute: `replay --pin` vs full re-investigation | µs vs s, ratio | | | |
| Evidence storage: content-addressed dedup ratio | bytes stored / bytes ingested | | | |
| Integrity verification: Merkle inclusion proof vs full re-scan | O(log n) vs O(n), wall clock | | | |
| RVD sweep throughput | cases/sec/core, zero inference | | | |
| Verdict reproducibility rate | % byte-identical across N replays | | | |

## Decision log

### YYYY-MM-DD — _(title)_
**Problem:**
**Alternatives considered:**
**Chosen approach and why:**
**Technical effect produced:**
**Files touched:**
