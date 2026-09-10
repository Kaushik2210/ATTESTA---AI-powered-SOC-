"""Focused correctness tests for the RVD sweep's attribution -- the
"claim-level and policy-level attribution" half of the Phase 8 gate
(phases/PHASES.md), plus the reopen workflow and the ambiguous-predicate
guard rail. See test_rvd_sweep_gate.py for the "exactly N cases drift,
throughput measured" half.
"""

from __future__ import annotations

import hashlib

import pytest

from attesta_adjudicate.case_record import build_case_record
from attesta_adjudicate.indicator_corpus import IndicatorCorpus, IndicatorEntry, corpus_hash
from attesta_adjudicate.manifest import BudgetConsumed, InferenceMeta
from attesta_adjudicate.rvd import build_augmented_policy, run_sweep
from attesta_adjudicate.store import ManifestStore
from attesta_investigate.models import Extractor, ExtractorKind, Polarity, ProposedClaim

TEST_SIGNING_KEY_SEED_HEX = "55" * 32

CURRENT_POLICY = {
    "policy_version": "policy.phase8-current",
    "predicate_weights": {
        "AUTH_FAILED_BURST": {"tactic": "credential-access", "weight": 2000, "techniques": ["T1110.001"]},
        "CONNECTED_TO_INDICATOR": {"tactic": "command-and-control", "weight": 0, "techniques": []},
    },
    "chain_multipliers": [],
    "severity_thresholds": [[0, "info"], [1000, "low"], [2000, "medium"], [3000, "high"]],
}

HOT_IP = "45.61.0.12"
COLD_IP = "9.9.9.9"


def fake_evidence_id(label: str) -> str:
    return "blake3:" + hashlib.sha256(label.encode()).hexdigest()


def _burst_claim() -> ProposedClaim:
    return ProposedClaim(
        predicate="AUTH_FAILED_BURST",
        subject="user:jdoe",
        interval_start_ns=0,
        interval_end_ns=100,
        evidence=[fake_evidence_id("burst-ev")],
        extractor=Extractor(kind=ExtractorKind.RULE, id="x", version="1"),
        polarity=Polarity.SUPPORTS,
    )


def _indicator_claim(ip: str) -> ProposedClaim:
    return ProposedClaim(
        predicate="CONNECTED_TO_INDICATOR",
        subject="host:h1",
        object=ip,
        interval_start_ns=100,
        interval_end_ns=200,
        evidence=[fake_evidence_id(f"net-{ip}")],
        extractor=Extractor(kind=ExtractorKind.RULE, id="x", version="1"),
        polarity=Polarity.SUPPORTS,
    )


def _close_case(store, case_id, claims, kernel_cli_path, manifest_cli_path, merkle_cli_path):
    return store.close_case(
        tenant_id="tenant-a",
        case_id=case_id,
        investigation_id=f"inv-{case_id}",
        accepted_claims=claims,
        policy=CURRENT_POLICY,  # unpriced indicator at close time -- same policy object, weight 0
        kernel_version="0.0.0-test",
        inference=InferenceMeta(provider="v", model_id="m", weights_digest="x"),
        budget_consumed=BudgetConsumed(tool_calls=len(claims), turns=1),
        started_at_ns=0,
        completed_at_ns=1,
        signing_key_seed_hex=TEST_SIGNING_KEY_SEED_HEX,
        kernel_cli_path=kernel_cli_path,
        manifest_cli_path=manifest_cli_path,
        merkle_cli_path=merkle_cli_path,
    )


def test_matching_case_drifts_with_correct_claim_and_policy_attribution(
    kernel_cli_path, manifest_cli_path, merkle_cli_path
) -> None:
    store = ManifestStore()
    case = _close_case(
        store, "case-hot", [_burst_claim(), _indicator_claim(HOT_IP)], kernel_cli_path, manifest_cli_path, merkle_cli_path
    )
    assert case.sealed_manifest.manifest.verdict_disposition == "suspicious"  # medium, indicator unpriced

    corpus = IndicatorCorpus(version="corpus.v2", entries=[IndicatorEntry(predicate="CONNECTED_TO_INDICATOR", value=HOT_IP, weight=5000, techniques=["T1071.001"])])
    result = run_sweep(store, CURRENT_POLICY, corpus, "0.0.0-test", kernel_cli_path, manifest_cli_path)

    assert result.cases_swept == 1
    assert len(result.drifts) == 1
    drift = result.drifts[0]

    assert drift.case_id == "case-hot"
    assert drift.old_disposition == "suspicious"
    assert drift.new_disposition == "malicious"

    # Claim-level attribution: the CONNECTED_TO_INDICATOR claim's id, not
    # the AUTH_FAILED_BURST claim's -- only one claim actually matched.
    indicator_claim_id = case.verdict["submitted_claim_ids"][1]
    assert drift.responsible_claim_ids == [indicator_claim_id]

    # Policy-level attribution: the exact predicate and the exact delta.
    assert len(drift.policy_deltas) == 1
    assert drift.policy_deltas[0].predicate == "CONNECTED_TO_INDICATOR"
    assert drift.policy_deltas[0].old_weight == 0
    assert drift.policy_deltas[0].new_weight == 5000

    assert drift.indicator_corpus_version == "corpus.v2"
    assert drift.indicator_corpus_hash == corpus_hash(corpus, manifest_cli_path)

    # Reopen workflow -- the closed record itself is untouched; the store
    # tracks reopening as separate workflow state.
    assert store.is_reopened("case-hot")
    assert store.drift_for("case-hot") is drift
    assert case.sealed_manifest.manifest.verdict_disposition == "suspicious"  # unchanged, still the signed original


def test_non_matching_indicator_value_does_not_drift(kernel_cli_path, manifest_cli_path, merkle_cli_path) -> None:
    """Same predicate, different IP -- proves matching is per indicator
    VALUE, not just per predicate class.
    """
    store = ManifestStore()
    _close_case(
        store, "case-cold", [_burst_claim(), _indicator_claim(COLD_IP)], kernel_cli_path, manifest_cli_path, merkle_cli_path
    )

    corpus = IndicatorCorpus(version="corpus.v2", entries=[IndicatorEntry(predicate="CONNECTED_TO_INDICATOR", value=HOT_IP, weight=5000)])
    result = run_sweep(store, CURRENT_POLICY, corpus, "0.0.0-test", kernel_cli_path, manifest_cli_path)

    assert result.drifts == []
    assert not store.is_reopened("case-cold")


def test_case_with_no_indicator_claim_at_all_is_skipped_not_reprocessed(
    kernel_cli_path, manifest_cli_path, merkle_cli_path
) -> None:
    store = ManifestStore()
    _close_case(store, "case-plain", [_burst_claim()], kernel_cli_path, manifest_cli_path, merkle_cli_path)

    corpus = IndicatorCorpus(version="corpus.v2", entries=[IndicatorEntry(predicate="CONNECTED_TO_INDICATOR", value=HOT_IP, weight=5000)])
    result = run_sweep(store, CURRENT_POLICY, corpus, "0.0.0-test", kernel_cli_path, manifest_cli_path)

    assert result.drifts == []
    assert not store.is_reopened("case-plain")


def test_two_conflicting_indicator_values_for_the_same_predicate_in_one_case_raises() -> None:
    claims_json = [
        {"predicate": "CONNECTED_TO_INDICATOR", "subject": "h", "object": "1.1.1.1", "interval_start_ns": 0, "interval_end_ns": 1, "evidence": ["e1"], "extractor_kind": "rule", "extractor_id": "x", "extractor_version": "1", "observed_value": None, "polarity": "supports", "hypothesis_ref": None},
        {"predicate": "CONNECTED_TO_INDICATOR", "subject": "h", "object": "2.2.2.2", "interval_start_ns": 0, "interval_end_ns": 1, "evidence": ["e2"], "extractor_kind": "rule", "extractor_id": "x", "extractor_version": "1", "observed_value": None, "polarity": "supports", "hypothesis_ref": None},
    ]
    corpus = IndicatorCorpus(
        version="v",
        entries=[
            IndicatorEntry(predicate="CONNECTED_TO_INDICATOR", value="1.1.1.1", weight=3000),
            IndicatorEntry(predicate="CONNECTED_TO_INDICATOR", value="2.2.2.2", weight=7000),
        ],
    )
    with pytest.raises(ValueError, match="different weights"):
        build_augmented_policy(CURRENT_POLICY, claims_json, ["id1", "id2"], corpus)


def test_indicator_for_an_unregistered_predicate_raises() -> None:
    claims_json = [
        {"predicate": "NEVER_SEEN_PREDICATE", "subject": "h", "object": "1.1.1.1", "interval_start_ns": 0, "interval_end_ns": 1, "evidence": ["e1"], "extractor_kind": "rule", "extractor_id": "x", "extractor_version": "1", "observed_value": None, "polarity": "supports", "hypothesis_ref": None},
    ]
    corpus = IndicatorCorpus(version="v", entries=[IndicatorEntry(predicate="NEVER_SEEN_PREDICATE", value="1.1.1.1", weight=1000)])
    with pytest.raises(ValueError, match="no entry in the current policy"):
        build_augmented_policy(CURRENT_POLICY, claims_json, ["id1"], corpus)


def test_corpus_hash_is_order_independent_and_content_sensitive(manifest_cli_path) -> None:
    a = IndicatorCorpus(version="v1", entries=[
        IndicatorEntry(predicate="P1", value="1.1.1.1", weight=100),
        IndicatorEntry(predicate="P2", value="2.2.2.2", weight=200),
    ])
    b = IndicatorCorpus(version="v1", entries=[
        IndicatorEntry(predicate="P2", value="2.2.2.2", weight=200),
        IndicatorEntry(predicate="P1", value="1.1.1.1", weight=100),
    ])
    c = IndicatorCorpus(version="v1", entries=[
        IndicatorEntry(predicate="P1", value="1.1.1.1", weight=999),  # different weight
        IndicatorEntry(predicate="P2", value="2.2.2.2", weight=200),
    ])
    assert corpus_hash(a, manifest_cli_path) == corpus_hash(b, manifest_cli_path)
    assert corpus_hash(a, manifest_cli_path) != corpus_hash(c, manifest_cli_path)
