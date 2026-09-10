"""Retro-Verdict Drift Detection -- docs/ARCHITECTURE.md 2.11, the
project's flagship claim: "[RVD] converts an audit log -- normally a pure
cost -- into a retroactive detection engine ... only possible because
verdicts are pure functions of a stable, content-addressed claim set. No
transcript-based product can do it."

The sweep re-adjudicates every closed case's STORED claim set against the
CURRENT policy (uniform across the whole sweep -- this is what makes it a
policy/kernel upgrade check, not a per-case replay) with one addition: any
predicate an indicator corpus entry newly prices gets that weight
substituted in, but only for the specific case(s) whose own claims cite
that specific indicator value. No re-ingestion. No re-running inference.
A closed BENIGN case with a `CONNECTED_TO_INDICATOR` claim citing an IP
that becomes a known-bad indicator six months later reopens automatically,
naming the exact claim and the exact policy delta responsible.

Scope note -- read before extending: matching is exact-string
(predicate, object) equality, not CIDR ranges, domain wildcards, or TLP
handling a real threat-intel feed needs. And because the kernel prices a
predicate globally, not per claim (`kernel/src/lib.rs`'s
`policy.predicate_weights.get(&claim.predicate)`), two different indicator
values that happen to share a predicate within the SAME case can't be
independently repriced -- `build_augmented_policy` raises rather than
silently picking one, since guessing which value "wins" would be exactly
the kind of unaudited discretion this project's determinism guarantees
exist to rule out. A predicate an indicator wants to reprice must already
exist in the current policy (any weight, even 0) so its `tactic` is known
-- the corpus supplies a weight/technique override, never a new tactic
assignment out of nothing.
"""

from __future__ import annotations

import copy
import time
from pathlib import Path
from typing import Any

from attesta_investigate.adjudicate_bridge import adjudicate_raw
from pydantic import BaseModel

from .indicator_corpus import IndicatorCorpus, corpus_hash
from .store import ManifestStore


class MatchedClaim(BaseModel):
    claim_id: str
    claim: dict[str, Any]
    predicate: str
    indicator_value: str
    weight: int


def build_augmented_policy(
    base_policy: dict[str, Any],
    claims: list[dict[str, Any]],
    claim_ids: list[str],
    corpus: IndicatorCorpus,
) -> tuple[dict[str, Any], list[MatchedClaim]]:
    """Returns (policy to actually adjudicate under, the claims that
    triggered a reprice). Returns `base_policy` itself, unmodified, when
    nothing in `claims` matches the corpus -- callers should treat that as
    "nothing to re-check" rather than paying for a redundant adjudication.
    """
    matches: list[MatchedClaim] = []
    overrides: dict[str, tuple[int, list[str]]] = {}

    for claim, claim_id in zip(claims, claim_ids):
        entry = corpus.matches(claim["predicate"], claim.get("object"))
        if entry is None:
            continue
        if entry.predicate in overrides and overrides[entry.predicate][0] != entry.weight:
            raise ValueError(
                f"two different indicator matches target predicate {entry.predicate!r} with "
                "different weights within the same case -- the kernel prices per predicate, "
                "not per claim, so this case can't be unambiguously repriced (see rvd.py's "
                "module doc comment)"
            )
        overrides[entry.predicate] = (entry.weight, entry.techniques)
        matches.append(
            MatchedClaim(
                claim_id=claim_id, claim=claim, predicate=entry.predicate,
                indicator_value=entry.value, weight=entry.weight,
            )
        )

    if not matches:
        return base_policy, []

    augmented = copy.deepcopy(base_policy)
    for predicate, (weight, techniques) in overrides.items():
        existing = augmented["predicate_weights"].get(predicate)
        if existing is None:
            raise ValueError(
                f"indicator corpus entry for predicate {predicate!r} has no entry in the "
                "current policy to inherit a tactic from -- register the predicate in the "
                "policy (any weight, even 0) before an indicator can reprice it"
            )
        augmented["predicate_weights"][predicate] = {
            "tactic": existing["tactic"],
            "weight": weight,
            "techniques": techniques or existing.get("techniques", []),
        }
    return augmented, matches


class PolicyDelta(BaseModel):
    predicate: str
    old_weight: int
    new_weight: int


class VerdictDrift(BaseModel):
    """docs/PHASES.md Phase 8 gate: "each naming the responsible claim and
    policy delta." Both are here, plainly: `responsible_claim_ids` is the
    claim-level attribution, `policy_deltas` is the policy-level
    attribution -- never just "the verdict changed."
    """

    case_id: str
    tenant_id: str
    old_severity: str
    new_severity: str
    old_disposition: str
    new_disposition: str
    old_verdict_hash: str
    new_verdict_hash: str
    responsible_claim_ids: list[str]
    policy_deltas: list[PolicyDelta]
    indicator_corpus_version: str
    indicator_corpus_hash: str


class SweepResult(BaseModel):
    cases_swept: int
    drifts: list[VerdictDrift]
    elapsed_seconds: float

    @property
    def throughput_cases_per_sec(self) -> float:
        if self.elapsed_seconds <= 0:
            return float("inf")
        return self.cases_swept / self.elapsed_seconds


def run_sweep(
    store: ManifestStore,
    current_policy: dict[str, Any],
    corpus: IndicatorCorpus,
    current_kernel_version: str,
    kernel_cli_path: Path,
    manifest_cli_path: Path,
) -> SweepResult:
    """docs/ARCHITECTURE.md 2.11's pseudocode, made real:

        for manifest in closed_investigations(window):
            new_claims = manifest.claims + intel_reevaluate(manifest.claims)
            new_verdict = adjudicate(new_claims, current_policy, current_kernel)
            if new_verdict.disposition != manifest.verdict.disposition:
                emit VerdictDrift(...)

    `intel_reevaluate` here is `build_augmented_policy`: rather than
    synthesizing new claims from re-parsed evidence (which would need a
    deterministic evidence-parsing layer this project hasn't built), the
    same effect -- "this specific already-extracted, already-pinned claim
    now means something the policy didn't know to price" -- is achieved by
    repricing the one predicate the matching claim already asserts,
    scoped to exactly the case(s) whose claims cite that specific
    indicator value. Cases with no matching claim are skipped entirely
    (not re-adjudicated at all), which is also the throughput-relevant
    difference from a naive "re-adjudicate everything" sweep.
    """
    corpus_ver_hash = corpus_hash(corpus, manifest_cli_path)
    cases = store.closed_investigations()
    drifts: list[VerdictDrift] = []

    start = time.perf_counter()
    for case in cases:
        claim_ids = case.verdict["submitted_claim_ids"]
        augmented_policy, matches = build_augmented_policy(current_policy, case.claims, claim_ids, corpus)
        if not matches:
            continue

        new_verdict = adjudicate_raw(case.claims, augmented_policy, current_kernel_version, kernel_cli_path)
        old = case.sealed_manifest.manifest

        if new_verdict["disposition"] == old.verdict_disposition and new_verdict["severity"] == old.verdict_severity:
            continue

        policy_deltas = []
        for m in matches:
            existing = current_policy["predicate_weights"].get(m.predicate)
            old_weight = existing["weight"] if existing else 0
            policy_deltas.append(PolicyDelta(predicate=m.predicate, old_weight=old_weight, new_weight=m.weight))

        drift = VerdictDrift(
            case_id=case.case_id,
            tenant_id=case.tenant_id,
            old_severity=old.verdict_severity,
            new_severity=new_verdict["severity"],
            old_disposition=old.verdict_disposition,
            new_disposition=new_verdict["disposition"],
            old_verdict_hash=old.verdict_hash,
            new_verdict_hash=new_verdict["verdict_hash"],
            responsible_claim_ids=[m.claim_id for m in matches],
            policy_deltas=policy_deltas,
            indicator_corpus_version=corpus.version,
            indicator_corpus_hash=corpus_ver_hash,
        )
        drifts.append(drift)
        store.mark_reopened(case.case_id, drift)

    elapsed = time.perf_counter() - start
    return SweepResult(cases_swept=len(cases), drifts=drifts, elapsed_seconds=elapsed)
