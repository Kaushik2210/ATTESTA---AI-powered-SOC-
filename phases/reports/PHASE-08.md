# Phase 8 — Retro-Verdict Drift Detection

**Status: gate passed**, first try on the substantive logic — the only follow-up needed was a CI output-capture fix (pytest silently swallows a passing test's stdout without `-s`) so the measured throughput actually reached the log, not a bug in the RVD mechanism itself.

## What was built

`docs/ARCHITECTURE.md` §2.11 calls this "the strongest thing in the system... it converts an audit log — normally a pure cost — into a retroactive detection engine. It is only possible because verdicts are pure functions of a stable, content-addressed claim set." Phase 8 builds the scheduler around the mechanism Phase 5 already proved at the kernel level (`unpriced_indicator_then_priced_indicator_changes_the_verdict`).

- **`services/adjudicate/attesta_adjudicate/indicator_corpus.py`** — `IndicatorEntry` (predicate + exact-match value + weight + techniques) and `IndicatorCorpus` (a versioned list of entries). `corpus_hash()` runs the corpus through the same canonical-CBOR + BLAKE3 path (`manifest_cli`'s `canon_hash` op) every other content address in this project uses — entries sorted before hashing, so two corpora with identical content hash identically regardless of list order. This is "indicator-corpus versioning" made concrete, not just a string label.
- **`services/adjudicate/attesta_adjudicate/rvd.py`** — the sweep itself:
  - `build_augmented_policy()` implements `docs/ARCHITECTURE.md`'s `intel_reevaluate(manifest.claims)` step: rather than synthesizing new claims from re-parsed evidence (which would need a deterministic evidence-parsing layer this project hasn't built), it scans a case's already-extracted, already-pinned claims for one whose `(predicate, object)` matches a corpus entry, and substitutes that predicate's weight in a policy copy scoped to just that case's re-adjudication. Two different indicator values sharing a predicate within one case raise rather than silently pick a winner — the kernel prices per predicate, not per claim, so there's no principled way to resolve that ambiguity, and this project's discipline is to surface an unresolvable case loudly rather than guess.
  - `run_sweep()` — for every closed case, skip entirely (no re-adjudication at all) unless a claim matches the corpus; for the ones that do, call the real kernel with the augmented policy and compare disposition/severity against the manifest's recorded verdict; on a genuine change, emit a `VerdictDrift` naming both the responsible claim id(s) (claim-level attribution) and the exact policy delta (predicate, old weight, new weight — policy-level attribution), and mark the case reopened.
- **`services/adjudicate/attesta_adjudicate/store.py`** — extended with a reopen workflow (`mark_reopened`/`is_reopened`/`drift_for`) kept as separate state from the immutable `CaseRecord`, matching invariant I3's append-only discipline: reopening never mutates the closed, signed record — it layers workflow state on top of one that stays independently verifiable exactly as it was sealed.

## The gate: exactly N cases drift, on a real corpus, with real attribution

`phases/PHASES.md`: *"seed a corpus, close cases, inject a new indicator matching a claim in N closed cases, run the sweep. Exactly those N cases emit VerdictDrift, each naming the responsible claim and policy delta. Measure and record throughput (cases/sec/core) — this number is your paper's headline."*

`test_sweep_flags_exactly_the_cases_citing_the_newly_priced_indicator` seeds 500 closed cases across three shapes, deliberately including the harder negative case a predicate-level-only test would miss:

| Shape | Count | Cites `CONNECTED_TO_INDICATOR` | Object value | Should drift |
|---|---|---|---|---|
| "hot" | 200 | yes | `45.61.0.12` (the corpus's new entry) | **yes** |
| "cold" | 150 | yes | `9.9.9.9` (same predicate, *not* in the corpus) | no |
| "plain" | 150 | no | — | no |

The "cold" shape is what actually tests per-*value* matching rather than per-predicate matching: if the sweep only checked "does this case have a `CONNECTED_TO_INDICATOR` claim at all," it would incorrectly drift 350 cases instead of 200. Confirmed in CI on both architectures — [run `34439899095`](https://github.com/Kaushik2210/ATTESTA---AI-powered-SOC-/actions/runs/34439899095): **exactly the 200 "hot" cases drifted**, all 350 others untouched and un-reopened, every drift correctly naming its one responsible claim id and a `policy_deltas` entry of `CONNECTED_TO_INDICATOR: 0 → 5000`.

A companion focused test file (`test_rvd_attribution.py`) covers the same properties on a small, readable scale plus two guard-rail cases: two conflicting indicator values for one predicate within a single case raises, and an indicator for a predicate the current policy has never registered raises rather than guessing a tactic.

### Throughput — the headline number

| Runner | Architecture | Cases considered | Cases re-adjudicated | Elapsed | Throughput |
|---|---|---|---|---|---|
| `ubuntu-latest` | x86_64 | 500 | 200 | 0.2003s | **2,495.7 cases/sec/core** |
| `macos-latest` | arm64 | 500 | 200 | 0.9197s | **543.7 cases/sec/core** |

Both numbers describe the same sweep discipline: every closed case is *considered* (checked for a matching claim), but only the ones that actually match get a real kernel subprocess spawned for re-adjudication — 300 of the 500 cases here cost nothing beyond a predicate/object string comparison. The architecture gap (x86_64 roughly 4.6× macOS CI runner throughput here) reflects GitHub Actions' shared-runner CPU allocation difference between the two images, not anything about the mechanism itself — see the scope note below on what this number does and doesn't claim.

## Scope decisions — read this first

- **Matching is exact-string `(predicate, object)` equality**, not CIDR-range, domain-wildcard, or TLP-aware matching a real threat-intel feed needs. The versioning and attribution properties this phase's gate actually tests don't depend on match sophistication — extending the matcher is additive, not a redesign.
- **A predicate must already exist in the current policy (any weight, even 0) before an indicator can reprice it.** The kernel requires every priced predicate to carry a `tactic`; an indicator corpus supplies a weight/technique override, never invents a tactic assignment from nothing. This mirrors Phase 5's own `brute_force_then_cnc_policy(indicator_weight)` fixture exactly — `CONNECTED_TO_INDICATOR` was always present in that policy, just unpriced (weight 0) until "now matches a threat feed."
- **Throughput here is single-process, single-core** — no parallel sweep workers. `docs/PHASES.md` asks the number to be "measured and recorded," not gated on a hardware-independent pass/fail threshold, which is exactly how this report treats it: two real numbers from two real CI runners, not a synthetic benchmark. Parallelizing the sweep across cores (an embarrassingly parallel workload — cases are independent) is a natural throughput multiplier for a later phase, not required to prove the mechanism here.
- **No time-window filter on `closed_investigations()`.** `docs/ARCHITECTURE.md` §2.11's pseudocode takes a `window` parameter; `ManifestStore.closed_investigations()` still returns everything, unfiltered (documented as a gap already in Phase 7's report). A real nightly sweep would scope this to avoid re-checking cases already swept since their last relevant policy/corpus change — an optimization, not a correctness requirement this gate depends on.

## `license-auditor` note

No new dependencies. `indicator_corpus.py` and `rvd.py` use only `pydantic` (already allowlisted) and Python stdlib (`copy`, `time`).

## Next

Waiting for approval before Phase 9.
