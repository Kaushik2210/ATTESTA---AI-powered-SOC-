"""The Phase 8 gate (phases/PHASES.md): "seed a corpus, close cases,
inject a new indicator matching a claim in N closed cases, run the sweep.
Exactly those N cases emit VerdictDrift, each naming the responsible
claim and policy delta. Measure and record throughput (cases/sec/core) --
this number is your paper's headline."

500 closed cases are seeded across three shapes:
  - 200 "hot"   cases: cite the indicator value the corpus is about to price
  - 150 "cold"  cases: cite the SAME predicate, a DIFFERENT indicator value
                       the corpus does NOT price (proves per-value, not
                       per-predicate, matching)
  - 150 "plain" cases: no indicator-predicate claim at all

Exactly the 200 "hot" cases must emit VerdictDrift. Throughput is measured
over the whole sweep (500 cases considered, only 200 actually
re-adjudicated) and printed/asserted sane, not gated on an arbitrary
number -- the concrete figure this run measures belongs in
phases/reports/PHASE-08.md, not hardcoded into a pass/fail bound that
would be meaningless across different CI hardware.
"""

from __future__ import annotations

import hashlib

from attesta_adjudicate.indicator_corpus import IndicatorCorpus, IndicatorEntry
from attesta_adjudicate.manifest import BudgetConsumed, InferenceMeta
from attesta_adjudicate.rvd import PolicyDelta, run_sweep
from attesta_adjudicate.store import ManifestStore
from attesta_investigate.models import Extractor, ExtractorKind, Polarity, ProposedClaim

TEST_SIGNING_KEY_SEED_HEX = "66" * 32

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

N_HOT, N_COLD, N_PLAIN = 200, 150, 150


def fake_evidence_id(label: str) -> str:
    return "blake3:" + hashlib.sha256(label.encode()).hexdigest()


def _burst_claim(case_index: int) -> ProposedClaim:
    return ProposedClaim(
        predicate="AUTH_FAILED_BURST",
        subject=f"user:u{case_index}",
        interval_start_ns=0,
        interval_end_ns=100,
        evidence=[fake_evidence_id(f"burst-{case_index}")],
        extractor=Extractor(kind=ExtractorKind.RULE, id="x", version="1"),
        polarity=Polarity.SUPPORTS,
    )


def _indicator_claim(case_index: int, ip: str) -> ProposedClaim:
    return ProposedClaim(
        predicate="CONNECTED_TO_INDICATOR",
        subject=f"host:h{case_index}",
        object=ip,
        interval_start_ns=100,
        interval_end_ns=200,
        evidence=[fake_evidence_id(f"net-{case_index}")],
        extractor=Extractor(kind=ExtractorKind.RULE, id="x", version="1"),
        polarity=Polarity.SUPPORTS,
    )


def test_sweep_flags_exactly_the_cases_citing_the_newly_priced_indicator(
    kernel_cli_path, manifest_cli_path, merkle_cli_path
) -> None:
    store = ManifestStore()
    hot_ids, cold_ids, plain_ids = [], [], []

    for i in range(N_HOT):
        case_id = f"hot-{i}"
        hot_ids.append(case_id)
        store.close_case(
            tenant_id=f"tenant-{i % 3}", case_id=case_id, investigation_id=f"inv-{case_id}",
            accepted_claims=[_burst_claim(i), _indicator_claim(i, HOT_IP)],
            policy=CURRENT_POLICY, kernel_version="0.0.0-test",
            inference=InferenceMeta(provider="v", model_id="m", weights_digest="x"),
            budget_consumed=BudgetConsumed(tool_calls=2, turns=1), started_at_ns=i, completed_at_ns=i + 1,
            signing_key_seed_hex=TEST_SIGNING_KEY_SEED_HEX,
            kernel_cli_path=kernel_cli_path, manifest_cli_path=manifest_cli_path, merkle_cli_path=merkle_cli_path,
        )

    for i in range(N_COLD):
        case_id = f"cold-{i}"
        cold_ids.append(case_id)
        store.close_case(
            tenant_id=f"tenant-{i % 3}", case_id=case_id, investigation_id=f"inv-{case_id}",
            accepted_claims=[_burst_claim(1000 + i), _indicator_claim(1000 + i, COLD_IP)],
            policy=CURRENT_POLICY, kernel_version="0.0.0-test",
            inference=InferenceMeta(provider="v", model_id="m", weights_digest="x"),
            budget_consumed=BudgetConsumed(tool_calls=2, turns=1), started_at_ns=i, completed_at_ns=i + 1,
            signing_key_seed_hex=TEST_SIGNING_KEY_SEED_HEX,
            kernel_cli_path=kernel_cli_path, manifest_cli_path=manifest_cli_path, merkle_cli_path=merkle_cli_path,
        )

    for i in range(N_PLAIN):
        case_id = f"plain-{i}"
        plain_ids.append(case_id)
        store.close_case(
            tenant_id=f"tenant-{i % 3}", case_id=case_id, investigation_id=f"inv-{case_id}",
            accepted_claims=[_burst_claim(2000 + i)],
            policy=CURRENT_POLICY, kernel_version="0.0.0-test",
            inference=InferenceMeta(provider="v", model_id="m", weights_digest="x"),
            budget_consumed=BudgetConsumed(tool_calls=1, turns=1), started_at_ns=i, completed_at_ns=i + 1,
            signing_key_seed_hex=TEST_SIGNING_KEY_SEED_HEX,
            kernel_cli_path=kernel_cli_path, manifest_cli_path=manifest_cli_path, merkle_cli_path=merkle_cli_path,
        )

    assert len(store) == N_HOT + N_COLD + N_PLAIN

    corpus = IndicatorCorpus(
        version="corpus.phase8-gate",
        entries=[IndicatorEntry(predicate="CONNECTED_TO_INDICATOR", value=HOT_IP, weight=5000, techniques=["T1071.001"])],
    )

    result = run_sweep(store, CURRENT_POLICY, corpus, "0.0.0-test", kernel_cli_path, manifest_cli_path)

    drifted_case_ids = {d.case_id for d in result.drifts}
    assert drifted_case_ids == set(hot_ids), (
        f"expected exactly the {N_HOT} hot cases to drift; "
        f"missing={set(hot_ids) - drifted_case_ids} unexpected={drifted_case_ids - set(hot_ids)}"
    )
    assert len(result.drifts) == N_HOT
    for case_id in cold_ids + plain_ids:
        assert not store.is_reopened(case_id)
    for case_id in hot_ids:
        assert store.is_reopened(case_id)

    for drift in result.drifts:
        assert drift.old_disposition == "suspicious"
        assert drift.new_disposition == "malicious"
        assert len(drift.responsible_claim_ids) == 1
        assert drift.policy_deltas == [PolicyDelta(predicate="CONNECTED_TO_INDICATOR", old_weight=0, new_weight=5000)]

    assert result.cases_swept == N_HOT + N_COLD + N_PLAIN
    assert result.elapsed_seconds > 0
    assert result.throughput_cases_per_sec > 0
    print(
        f"\nRVD sweep throughput: {result.cases_swept} cases considered, "
        f"{N_HOT} re-adjudicated, {result.elapsed_seconds:.4f}s, "
        f"{result.throughput_cases_per_sec:.1f} cases/sec/core"
    )
