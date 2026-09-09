"""Direct tests of the manifest_cli/merkle_cli bridge (manifest.py) --
sealing, verification, tamper detection, and per-tenant chaining, at the
Python-Go boundary rather than through the full case-building pipeline.
"""

from __future__ import annotations

import hashlib

from attesta_adjudicate.manifest import (
    BudgetConsumed,
    InferenceMeta,
    Manifest,
    merkle_prove,
    merkle_verify,
    seal_manifest,
    verify_sealed_manifest,
)

TEST_SIGNING_KEY_SEED_HEX = "22" * 32


def fake_hash_hex(label: str) -> str:
    """A plain 64-hex-char stand-in hash, no "blake3:" prefix -- the shape
    Manifest's own hash-like fields (claim_set_hash, verdict_hash,
    claim_ids[], etc.) take, matching manifest_cli's decodeHex32.
    """
    return hashlib.sha256(label.encode()).hexdigest()


def fake_evidence_id(label: str) -> str:
    """The "blake3:<hex>" display form (ledger.EvidenceID.String()) --
    what merkle_cli's evidence-id fields expect; NOT the shape Manifest's
    own hash fields take (see fake_hash_hex above).
    """
    return "blake3:" + hashlib.sha256(label.encode()).hexdigest()


def _sample_manifest(**overrides: object) -> Manifest:
    defaults: dict[str, object] = dict(
        investigation_id="inv-1",
        tenant_id="tenant-a",
        case_id="case-1",
        claim_set_hash=fake_hash_hex("claims"),
        claim_ids=[fake_hash_hex("claim-0")],
        inference=InferenceMeta(provider="vendor-a", model_id="fake-model-a", weights_digest="blake3:x"),
        policy_version="policy.v1",
        kernel_version="0.0.0-test",
        verdict_severity="high",
        verdict_confidence=4200,
        verdict_disposition="malicious",
        verdict_hash=fake_hash_hex("verdict"),
        budget_consumed=BudgetConsumed(tool_calls=2, turns=1),
        started_at_ns=0,
        completed_at_ns=1000,
    )
    defaults.update(overrides)
    return Manifest(**defaults)  # type: ignore[arg-type]


def test_seal_and_verify_round_trips(manifest_cli_path) -> None:
    sealed = seal_manifest(_sample_manifest(), TEST_SIGNING_KEY_SEED_HEX, manifest_cli_path)
    assert verify_sealed_manifest(sealed, manifest_cli_path) is True


def test_seal_is_deterministic_for_identical_manifests(manifest_cli_path) -> None:
    a = seal_manifest(_sample_manifest(), TEST_SIGNING_KEY_SEED_HEX, manifest_cli_path)
    b = seal_manifest(_sample_manifest(), TEST_SIGNING_KEY_SEED_HEX, manifest_cli_path)
    assert a.manifest_hash == b.manifest_hash


def test_verify_rejects_a_manifest_tampered_after_sealing(manifest_cli_path) -> None:
    sealed = seal_manifest(_sample_manifest(), TEST_SIGNING_KEY_SEED_HEX, manifest_cli_path)
    tampered = sealed.model_copy(deep=True)
    tampered.manifest.verdict_disposition = "benign"
    assert verify_sealed_manifest(tampered, manifest_cli_path) is False


def test_verify_rejects_a_wrong_manifest_hash(manifest_cli_path) -> None:
    sealed = seal_manifest(_sample_manifest(), TEST_SIGNING_KEY_SEED_HEX, manifest_cli_path)
    tampered = sealed.model_copy(deep=True)
    tampered.manifest_hash = fake_hash_hex("wrong")
    assert verify_sealed_manifest(tampered, manifest_cli_path) is False


def test_chained_manifests_link_via_prev_manifest_hash(manifest_cli_path) -> None:
    first = seal_manifest(_sample_manifest(case_id="case-1"), TEST_SIGNING_KEY_SEED_HEX, manifest_cli_path)
    second_manifest = _sample_manifest(case_id="case-2", prev_manifest_hash=first.manifest_hash)
    second = seal_manifest(second_manifest, TEST_SIGNING_KEY_SEED_HEX, manifest_cli_path)

    assert second.manifest.prev_manifest_hash == first.manifest_hash
    assert verify_sealed_manifest(first, manifest_cli_path) is True
    assert verify_sealed_manifest(second, manifest_cli_path) is True

    # Splicing in a manifest with the wrong prev breaks the chain
    # detectably -- the whole point of chaining -- because the changed
    # prev_manifest_hash changes the manifest's own hash, invalidating
    # its signature against the recorded manifest_hash.
    spliced = second.model_copy(deep=True)
    spliced.manifest.prev_manifest_hash = fake_hash_hex("wrong-prev")
    assert verify_sealed_manifest(spliced, manifest_cli_path) is False


def test_merkle_inclusion_proof_verifies_for_a_real_member(merkle_cli_path) -> None:
    ids = [fake_evidence_id(f"ev-{i}") for i in range(5)]
    proof = merkle_prove(ids, 2, merkle_cli_path)
    assert merkle_verify(ids[2], proof, proof.root, merkle_cli_path) is True


def test_merkle_inclusion_proof_fails_for_a_non_member(merkle_cli_path) -> None:
    ids = [fake_evidence_id(f"ev-{i}") for i in range(5)]
    proof = merkle_prove(ids, 2, merkle_cli_path)
    assert merkle_verify(fake_evidence_id("not-a-member"), proof, proof.root, merkle_cli_path) is False


def test_merkle_inclusion_proof_fails_against_a_tampered_root(merkle_cli_path) -> None:
    ids = [fake_evidence_id(f"ev-{i}") for i in range(5)]
    proof = merkle_prove(ids, 2, merkle_cli_path)
    wrong_root = fake_hash_hex("wrong-root")
    assert merkle_verify(ids[2], proof, wrong_root, merkle_cli_path) is False
