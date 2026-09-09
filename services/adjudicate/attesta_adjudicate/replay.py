"""The Replay Executor -- docs/ARCHITECTURE.md 2.10's two modes:

  replay --pin       stored claim set + pinned policy/kernel versions
                      -> bit-identical verdict, always. The audit path.
  replay --rederive   pinned evidence, re-run claim extraction
                      -> claim-set *semantic* diff, extraction drift
                      quantified.

`--pin` never touches inference in any way -- it doesn't even know a
model exists. That is the whole point: it is what makes "rotate the
model, upgrade the inference provider, restart every service" a non-event
for this path, not something it has to defend against by being clever.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from attesta_investigate.adjudicate_bridge import adjudicate_raw, claim_to_json
from attesta_investigate.claim_gate import ClaimGate
from attesta_investigate.investigator import run_investigation
from attesta_investigate.provider import InferenceProvider
from pydantic import BaseModel

from .case_record import CaseRecord


class ReplayPinResult(BaseModel):
    case_id: str
    verdict_hash_matches: bool
    original_verdict_hash: str
    replayed_verdict_hash: str


def replay_pin(case: CaseRecord, kernel_cli_path: Path) -> ReplayPinResult:
    """Re-submits `case.claims` exactly as stored (never reconstructed
    from evidence, never re-run through the Claim Gate or an inference
    provider) to a brand-new `adjudicate_cli` subprocess, and checks the
    resulting verdict_hash against the one recorded in the case's own
    manifest at close time. A fresh subprocess every call is not
    incidental: it is this project's actual proxy for "restart every
    service" within an environment that has no long-running services to
    restart yet (see phases/reports/PHASE-07.md's scope note) — there is
    no global, no cache, no warm state that could survive between two
    calls to this function even if one wanted there to be.
    """
    result = adjudicate_raw(case.claims, case.policy, case.kernel_version, kernel_cli_path)
    replayed_hash = result["verdict_hash"]
    original_hash = case.sealed_manifest.manifest.verdict_hash
    return ReplayPinResult(
        case_id=case.case_id,
        verdict_hash_matches=(replayed_hash == original_hash),
        original_verdict_hash=original_hash,
        replayed_verdict_hash=replayed_hash,
    )


class ClaimDiff(BaseModel):
    added: list[dict[str, Any]]
    removed: list[dict[str, Any]]
    unchanged_count: int


class ReplayRederiveResult(BaseModel):
    case_id: str
    diff: ClaimDiff
    original_disposition: str
    rederived_disposition: str
    disposition_changed: bool


def replay_rederive(
    case: CaseRecord,
    evidence_context: str,
    provider: InferenceProvider,
    gate: ClaimGate,
    kernel_cli_path: Path,
) -> ReplayRederiveResult:
    """Re-runs claim EXTRACTION from scratch against the pinned evidence
    (a fresh investigation, possibly with a different provider — a
    rotated or upgraded model, in the adversarial-gate sense) and reports
    the *semantic* diff against the originally stored claim set, plus
    whether the resulting disposition moved. Unlike `--pin`, this
    necessarily costs a full investigation, because unlike `--pin` it is
    not claiming bit-reproducibility — docs/ARCHITECTURE.md 2.10 is
    explicit that LLM inference is not bit-reproducible even at
    temperature 0, and `--rederive` exists specifically to give an honest
    *measurement* of how much the reasoning layer drifts, not a false
    guarantee that it doesn't.
    """
    rederived = run_investigation(evidence_context, provider, gate)
    # The diff key deliberately excludes extractor identity, observed_value,
    # and hypothesis_ref: --rederive measures whether the *assertion* a
    # rederivation makes changed (the thing docs/ARCHITECTURE.md 2.10 calls
    # "extraction drift"), not whether the second run happened to attach a
    # different bookkeeping label to an otherwise-identical claim.
    rederived_claims_json = [
        {
            "predicate": c.predicate,
            "subject": c.subject,
            "object": c.object,
            "interval_start_ns": c.interval_start_ns,
            "interval_end_ns": c.interval_end_ns,
            "evidence": sorted(c.evidence),
            "polarity": c.polarity.value,
        }
        for c in rederived.accepted_claims
    ]
    original_claims_json = [
        {
            "predicate": c["predicate"],
            "subject": c["subject"],
            "object": c["object"],
            "interval_start_ns": c["interval_start_ns"],
            "interval_end_ns": c["interval_end_ns"],
            "evidence": sorted(c["evidence"]),
            "polarity": c["polarity"],
        }
        for c in case.claims
    ]

    def _key(c: dict[str, Any]) -> str:
        return json.dumps(c, sort_keys=True)

    original_by_key = {_key(c): c for c in original_claims_json}
    rederived_by_key = {_key(c): c for c in rederived_claims_json}

    added = [c for k, c in rederived_by_key.items() if k not in original_by_key]
    removed = [c for k, c in original_by_key.items() if k not in rederived_by_key]
    unchanged = len(original_by_key.keys() & rederived_by_key.keys())

    rederived_verdict = adjudicate_raw(
        [claim_to_json(c) for c in rederived.accepted_claims],
        case.policy,
        case.kernel_version,
        kernel_cli_path,
    )

    return ReplayRederiveResult(
        case_id=case.case_id,
        diff=ClaimDiff(added=added, removed=removed, unchanged_count=unchanged),
        original_disposition=case.sealed_manifest.manifest.verdict_disposition,
        rederived_disposition=rederived_verdict["disposition"],
        disposition_changed=(rederived_verdict["disposition"] != case.sealed_manifest.manifest.verdict_disposition),
    )
