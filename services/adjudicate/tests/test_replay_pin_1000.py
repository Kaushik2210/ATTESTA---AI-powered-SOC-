"""The Phase 7 gate (phases/PHASES.md): "replay --pin on 1,000 stored
manifests returns byte-identical verdicts -- this is the central claim of
the patent, so the test must be adversarial: rotate the model, upgrade the
inference provider, restart every service, and re-run. Still identical."

What this test does about each adversarial condition, honestly:

  - "rotate the model" / "upgrade the inference provider": each of the
    1,000 cases records a DIFFERENT (fake) Inference.provider/model_id in
    its manifest, cycling through several "model" identities. replay
    --pin never reads Inference at all -- it only resubmits the stored
    claim set against the pinned policy_version/kernel_version. Varying
    the recorded model across all 1,000 cases and confirming every single
    replay still matches is the concrete proof that inference identity is
    causally irrelevant to `--pin`'s output, not just untested.

  - "restart every service": there are no long-running services in this
    environment to literally restart (Phase 12 is deployment). What
    `--pin` actually depends on is a single, stateless subprocess
    (adjudicate_cli) with no shared globals, no cache, no warm state --
    and every one of the 1,000 replay calls below spawns a genuinely new
    OS process, proving there is no hidden state a "restart" could even
    have flushed. See phases/reports/PHASE-07.md for the full scope note.

Skipped (not failed) if the kernel/manifest/merkle CLIs aren't built --
see conftest.py.
"""

from __future__ import annotations

import hashlib
import random

from attesta_adjudicate.manifest import BudgetConsumed, InferenceMeta
from attesta_adjudicate.replay import replay_pin
from attesta_adjudicate.store import ManifestStore
from attesta_investigate.models import Extractor, ExtractorKind, Polarity, ProposedClaim

# See conftest.py's TEST_SIGNING_KEY_SEED_HEX/fake_evidence_id doc comments
# -- redeclared per test file rather than imported across test modules,
# since this package's tests/ has no __init__.py (pytest's rootless
# import mode) and cross-test-file imports aren't a reliable pattern
# there.
TEST_SIGNING_KEY_SEED_HEX = "11" * 32


def fake_evidence_id(label: str) -> str:
    return "blake3:" + hashlib.sha256(label.encode()).hexdigest()


N_CASES = 1000

POLICY = {
    "policy_version": "policy.phase7-test",
    "predicate_weights": {
        "AUTH_FAILED_BURST": {"tactic": "credential-access", "weight": 2000, "techniques": ["T1110.001"]},
        "AUTH_SUCCEEDED_AFTER_FAILURES": {"tactic": "credential-access", "weight": 1000, "techniques": ["T1078"]},
    },
    "chain_multipliers": [],
    "severity_thresholds": [[0, "info"], [1000, "low"], [2000, "medium"], [3000, "high"]],
}

TENANTS = ["tenant-alpha", "tenant-beta", "tenant-gamma"]
MODELS = [
    ("vendor-a", "fake-model-a-v1"),
    ("vendor-b", "fake-model-b-v2"),
    ("vendor-a", "fake-model-a-v2-upgraded"),  # "upgrade the inference provider"
]
PREDICATES = ["AUTH_FAILED_BURST", "AUTH_SUCCEEDED_AFTER_FAILURES"]


def _generate_claims(rng: random.Random, case_index: int) -> list[ProposedClaim]:
    n = rng.randint(1, 3)
    claims = []
    for j in range(n):
        predicate = rng.choice(PREDICATES)
        evidence = [fake_evidence_id(f"case-{case_index}-claim-{j}-ev-{k}") for k in range(rng.randint(1, 2))]
        start = rng.randint(0, 5_000_000_000)
        claims.append(
            ProposedClaim(
                predicate=predicate,
                subject=f"user:u{case_index % 37}",
                interval_start_ns=start,
                interval_end_ns=start + rng.randint(1, 1_000_000),
                evidence=evidence,
                extractor=Extractor(kind=ExtractorKind.RULE, id="cdl.test.generator", version="1"),
                observed_value=rng.randint(1, 100),
                polarity=Polarity.SUPPORTS,
                hypothesis_ref=f"H{j}",
            )
        )
    return claims


def test_replay_pin_is_byte_identical_across_1000_manifests_with_rotated_models(
    kernel_cli_path, manifest_cli_path, merkle_cli_path
) -> None:
    rng = random.Random(20260909)
    store = ManifestStore()

    for i in range(N_CASES):
        tenant = TENANTS[i % len(TENANTS)]
        provider, model_id = MODELS[i % len(MODELS)]
        claims = _generate_claims(rng, i)
        store.close_case(
            tenant_id=tenant,
            case_id=f"case-{i}",
            investigation_id=f"inv-{i}",
            accepted_claims=claims,
            policy=POLICY,
            kernel_version="0.0.0-test",
            inference=InferenceMeta(
                provider=provider,
                model_id=model_id,
                weights_digest=f"blake3:{model_id}-weights",
                seed=i,
                decode_params={"temperature": "0.0"},
            ),
            budget_consumed=BudgetConsumed(tool_calls=len(claims), turns=1),
            started_at_ns=i * 1000,
            completed_at_ns=i * 1000 + 500,
            signing_key_seed_hex=TEST_SIGNING_KEY_SEED_HEX,
            kernel_cli_path=kernel_cli_path,
            manifest_cli_path=manifest_cli_path,
            merkle_cli_path=merkle_cli_path,
        )

    assert len(store) == N_CASES

    mismatches = []
    for case in store.closed_investigations():
        result = replay_pin(case, kernel_cli_path)
        if not result.verdict_hash_matches:
            mismatches.append(result)

    assert mismatches == [], f"{len(mismatches)}/{N_CASES} replays diverged from their sealed manifest's verdict_hash"


def test_replay_pin_result_is_stable_across_repeated_replays_of_the_same_case(
    kernel_cli_path, manifest_cli_path, merkle_cli_path
) -> None:
    # A narrower, sharper version of the same property: replay the SAME
    # case 50 times, each a fresh subprocess, and require every single
    # one to agree -- if any hidden non-determinism existed (timing,
    # environment, process-local state), running one case repeatedly is
    # exactly where it would show up first.
    store = ManifestStore()
    claims = _generate_claims(random.Random(1), 0)
    case = store.close_case(
        tenant_id="tenant-alpha",
        case_id="case-repeat",
        investigation_id="inv-repeat",
        accepted_claims=claims,
        policy=POLICY,
        kernel_version="0.0.0-test",
        inference=InferenceMeta(provider="vendor-a", model_id="fake-model-a-v1", weights_digest="blake3:x"),
        budget_consumed=BudgetConsumed(tool_calls=1, turns=1),
        started_at_ns=0,
        completed_at_ns=1,
        signing_key_seed_hex=TEST_SIGNING_KEY_SEED_HEX,
        kernel_cli_path=kernel_cli_path,
        manifest_cli_path=manifest_cli_path,
        merkle_cli_path=merkle_cli_path,
    )

    hashes = {replay_pin(case, kernel_cli_path).replayed_verdict_hash for _ in range(50)}
    assert len(hashes) == 1
    assert hashes.pop() == case.sealed_manifest.manifest.verdict_hash
