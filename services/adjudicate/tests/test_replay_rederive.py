"""docs/ARCHITECTURE.md 2.10: `replay --rederive` re-runs claim
extraction against the pinned evidence and reports a claim-set semantic
diff, quantifying extraction drift -- the honest counterpart to `--pin`'s
hard guarantee. These tests exercise it with deterministic scripted
providers (the same methodological choice Phase 6's injection-containment
tests made, and for the same reason: the property under test -- that the
diff mechanism correctly reports what changed -- doesn't depend on
whether a live model happens to drift on any given day).
"""

from __future__ import annotations

import hashlib

from attesta_adjudicate.case_record import build_case_record
from attesta_adjudicate.manifest import BudgetConsumed, InferenceMeta
from attesta_adjudicate.replay import replay_rederive
from attesta_investigate.claim_gate import ClaimGate
from attesta_investigate.models import Extractor, ExtractorKind, Polarity, ProposedClaim
from attesta_investigate.provider import FakeScriptedProvider, ProviderTurn

TEST_SIGNING_KEY_SEED_HEX = "33" * 32

POLICY = {
    "policy_version": "policy.phase7-rederive-test",
    "predicate_weights": {
        "AUTH_FAILED_BURST": {"tactic": "credential-access", "weight": 2000, "techniques": ["T1110.001"]},
        "AUTH_SUCCEEDED_AFTER_FAILURES": {"tactic": "credential-access", "weight": 1000, "techniques": ["T1078"]},
    },
    "chain_multipliers": [],
    "severity_thresholds": [[0, "info"], [1000, "low"], [2000, "medium"], [3000, "high"]],
}


def fake_evidence_id(label: str) -> str:
    return "blake3:" + hashlib.sha256(label.encode()).hexdigest()


EV1 = fake_evidence_id("ev1")
EV2 = fake_evidence_id("ev2")


def _burst_claim() -> ProposedClaim:
    return ProposedClaim(
        predicate="AUTH_FAILED_BURST",
        subject="user:jdoe",
        interval_start_ns=1_000,
        interval_end_ns=2_000,
        evidence=[EV1],
        extractor=Extractor(kind=ExtractorKind.LLM, id="investigator", version="1"),
        polarity=Polarity.SUPPORTS,
    )


def _success_claim() -> ProposedClaim:
    return ProposedClaim(
        predicate="AUTH_SUCCEEDED_AFTER_FAILURES",
        subject="user:jdoe",
        interval_start_ns=2_000,
        interval_end_ns=3_000,
        evidence=[EV2],
        extractor=Extractor(kind=ExtractorKind.LLM, id="investigator", version="1"),
        polarity=Polarity.SUPPORTS,
    )


def _build_case(kernel_cli_path, manifest_cli_path, merkle_cli_path):
    return build_case_record(
        tenant_id="tenant-a",
        case_id="case-1",
        investigation_id="inv-1",
        accepted_claims=[_burst_claim()],
        policy=POLICY,
        kernel_version="0.0.0-test",
        inference=InferenceMeta(provider="vendor-a", model_id="fake-model-a-v1", weights_digest="blake3:x"),
        budget_consumed=BudgetConsumed(tool_calls=1, turns=1),
        started_at_ns=0,
        completed_at_ns=1000,
        prev_manifest_hash="",
        signing_key_seed_hex=TEST_SIGNING_KEY_SEED_HEX,
        kernel_cli_path=kernel_cli_path,
        manifest_cli_path=manifest_cli_path,
        merkle_cli_path=merkle_cli_path,
    )


def _gate() -> ClaimGate:
    return ClaimGate(pinned_evidence_ids={EV1, EV2}, case_window_start_ns=0, case_window_end_ns=10_000)


def test_rederive_reports_no_drift_when_the_second_run_matches_the_first(
    kernel_cli_path, manifest_cli_path, merkle_cli_path
) -> None:
    case = _build_case(kernel_cli_path, manifest_cli_path, merkle_cli_path)
    provider = FakeScriptedProvider(model_id="fake-model-a-v1-rerun", script=[ProviderTurn(proposed_claims=[_burst_claim()])])

    result = replay_rederive(case, "same evidence, no drift", provider, _gate(), kernel_cli_path)

    assert result.diff.added == []
    assert result.diff.removed == []
    assert result.diff.unchanged_count == 1
    assert result.disposition_changed is False
    assert result.rederived_disposition == result.original_disposition


def test_rederive_reports_an_added_claim_when_a_rotated_model_finds_more(
    kernel_cli_path, manifest_cli_path, merkle_cli_path
) -> None:
    case = _build_case(kernel_cli_path, manifest_cli_path, merkle_cli_path)
    # A "rotated" / "upgraded" model that additionally surfaces the
    # AUTH_SUCCEEDED_AFTER_FAILURES claim the first run missed.
    rotated_provider = FakeScriptedProvider(
        model_id="fake-model-b-v2-upgraded",
        script=[ProviderTurn(proposed_claims=[_burst_claim(), _success_claim()])],
    )

    result = replay_rederive(case, "same evidence, a more thorough model", rotated_provider, _gate(), kernel_cli_path)

    assert len(result.diff.added) == 1
    assert result.diff.added[0]["predicate"] == "AUTH_SUCCEEDED_AFTER_FAILURES"
    assert result.diff.removed == []
    assert result.diff.unchanged_count == 1


def test_rederive_reports_a_removed_claim_when_a_rotated_model_finds_less(
    kernel_cli_path, manifest_cli_path, merkle_cli_path
) -> None:
    case = _build_case(kernel_cli_path, manifest_cli_path, merkle_cli_path)
    empty_provider = FakeScriptedProvider(model_id="fake-model-c-conservative", script=[ProviderTurn(proposed_claims=[])])

    result = replay_rederive(case, "same evidence, a more conservative model", empty_provider, _gate(), kernel_cli_path)

    assert result.diff.added == []
    assert len(result.diff.removed) == 1
    assert result.diff.removed[0]["predicate"] == "AUTH_FAILED_BURST"
    assert result.diff.unchanged_count == 0
