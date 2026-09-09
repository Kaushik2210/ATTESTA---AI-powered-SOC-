"""docs/ARCHITECTURE.md 2.9's export bundle: "a self-contained bundle:
manifest + claim set + evidence inclusion proofs + kernel WASM binary +
policy bundle. A third party with that bundle and no access to your
systems can verify the verdict." See export_bundle.py's module doc
comment for this phase's scope note on the WASM binary specifically.

`test_bundle_verifies_from_a_completely_fresh_process` is the closest
proxy this environment can offer for "verifies on a clean machine with no
network access": it shells out to a brand-new Python subprocess that
imports nothing from this test module or from any in-memory CaseRecord --
only the files `export_bundle` wrote to disk, plus the three local CLI
binaries.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import textwrap

from attesta_adjudicate.case_record import build_case_record
from attesta_adjudicate.export_bundle import export_bundle, verify_bundle
from attesta_adjudicate.manifest import BudgetConsumed, InferenceMeta
from attesta_investigate.models import Extractor, ExtractorKind, Polarity, ProposedClaim

TEST_SIGNING_KEY_SEED_HEX = "44" * 32

POLICY = {
    "policy_version": "policy.phase7-bundle-test",
    "predicate_weights": {
        "AUTH_FAILED_BURST": {"tactic": "credential-access", "weight": 2000, "techniques": ["T1110.001"]},
    },
    "chain_multipliers": [],
    "severity_thresholds": [[0, "info"], [1000, "low"], [2000, "medium"], [3000, "high"]],
}


def fake_evidence_id(label: str) -> str:
    return "blake3:" + hashlib.sha256(label.encode()).hexdigest()


def _build_case(kernel_cli_path, manifest_cli_path, merkle_cli_path):
    claim = ProposedClaim(
        predicate="AUTH_FAILED_BURST",
        subject="user:jdoe",
        interval_start_ns=0,
        interval_end_ns=1000,
        evidence=[fake_evidence_id("ev1"), fake_evidence_id("ev2")],
        extractor=Extractor(kind=ExtractorKind.LLM, id="investigator", version="1"),
        polarity=Polarity.SUPPORTS,
    )
    return build_case_record(
        tenant_id="tenant-a",
        case_id="case-bundle",
        investigation_id="inv-bundle",
        accepted_claims=[claim],
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


def test_export_writes_a_self_contained_bundle(tmp_path, kernel_cli_path, manifest_cli_path, merkle_cli_path) -> None:
    case = _build_case(kernel_cli_path, manifest_cli_path, merkle_cli_path)
    out_dir = export_bundle(case, tmp_path / "bundle", merkle_cli_path)

    for name in ("manifest.json", "claims.json", "policy.json", "verdict.json", "kernel_version.txt", "evidence_inclusion.json"):
        assert (out_dir / name).exists(), f"missing {name} in exported bundle"

    inclusion = json.loads((out_dir / "evidence_inclusion.json").read_text())
    assert set(inclusion["proofs"].keys()) == set(case.evidence_ids)


def test_bundle_verifies_in_process(tmp_path, kernel_cli_path, manifest_cli_path, merkle_cli_path) -> None:
    case = _build_case(kernel_cli_path, manifest_cli_path, merkle_cli_path)
    out_dir = export_bundle(case, tmp_path / "bundle", merkle_cli_path)

    result = verify_bundle(out_dir, kernel_cli_path, manifest_cli_path, merkle_cli_path)
    assert result.ok, result.errors


def test_bundle_verification_fails_on_a_tampered_claim(tmp_path, kernel_cli_path, manifest_cli_path, merkle_cli_path) -> None:
    case = _build_case(kernel_cli_path, manifest_cli_path, merkle_cli_path)
    out_dir = export_bundle(case, tmp_path / "bundle", merkle_cli_path)

    claims = json.loads((out_dir / "claims.json").read_text())
    claims[0]["observed_value"] = (claims[0]["observed_value"] or 0) + 999
    (out_dir / "claims.json").write_text(json.dumps(claims))

    result = verify_bundle(out_dir, kernel_cli_path, manifest_cli_path, merkle_cli_path)
    # The manifest's own signature still checks out (nobody touched
    # manifest.json) but the recomputed verdict no longer matches the
    # signed claim_set_hash's implied content -- caught here as a
    # verdict_hash mismatch, which is the property that actually matters:
    # a tampered claim set produces a verdict that disagrees with what was
    # signed.
    assert result.manifest_signature_valid is True
    assert result.verdict_hash_matches is False
    assert result.ok is False


def test_bundle_verification_fails_when_inclusion_proof_root_disagrees_with_manifest(
    tmp_path, kernel_cli_path, manifest_cli_path, merkle_cli_path
) -> None:
    """A proof that is internally self-consistent (it really does
    recompute to the root it claims) but whose root is NOT the one the
    signed manifest committed to as epoch_root must still fail -- see
    export_bundle.verify_bundle's comment on why checking only internal
    proof consistency isn't enough.
    """
    from attesta_adjudicate.manifest import merkle_prove

    case = _build_case(kernel_cli_path, manifest_cli_path, merkle_cli_path)
    out_dir = export_bundle(case, tmp_path / "bundle", merkle_cli_path)

    # A proof that IS genuinely, internally self-consistent for the real
    # evidence id -- it really does recompute to the root it claims --
    # but built from a different batch (the real evidence id plus a
    # filler member) than the one the manifest's epoch_root actually
    # commits to. This is what isolates the new cross-check from the
    # plain self-consistency check: merkle_verify(evidence_id, proof,
    # proof.root) returns True here, and only the root-vs-manifest
    # comparison catches the substitution.
    inclusion = json.loads((out_dir / "evidence_inclusion.json").read_text())
    some_evidence_id = next(iter(inclusion["proofs"]))
    decoy_batch = [some_evidence_id, fake_evidence_id("filler")]
    decoy_proof = merkle_prove(decoy_batch, 0, merkle_cli_path)
    assert decoy_proof.root != case.sealed_manifest.manifest.epoch_root

    inclusion["proofs"][some_evidence_id] = decoy_proof.model_dump(mode="json")
    (out_dir / "evidence_inclusion.json").write_text(json.dumps(inclusion))

    result = verify_bundle(out_dir, kernel_cli_path, manifest_cli_path, merkle_cli_path)
    assert result.evidence_inclusion_valid is False
    assert result.ok is False


def test_bundle_verification_fails_on_a_tampered_manifest(tmp_path, kernel_cli_path, manifest_cli_path, merkle_cli_path) -> None:
    case = _build_case(kernel_cli_path, manifest_cli_path, merkle_cli_path)
    out_dir = export_bundle(case, tmp_path / "bundle", merkle_cli_path)

    manifest_data = json.loads((out_dir / "manifest.json").read_text())
    manifest_data["manifest"]["verdict_disposition"] = "benign"
    (out_dir / "manifest.json").write_text(json.dumps(manifest_data))

    result = verify_bundle(out_dir, kernel_cli_path, manifest_cli_path, merkle_cli_path)
    assert result.manifest_signature_valid is False
    assert result.ok is False


def test_bundle_verifies_from_a_completely_fresh_process(
    tmp_path, kernel_cli_path, manifest_cli_path, merkle_cli_path
) -> None:
    """The honest proxy for "clean machine, no network access": a
    subprocess that starts with nothing but the bundle directory and the
    three binary paths on its command line, imports only attesta_adjudicate
    fresh, and never touches this test process's Python objects.
    """
    case = _build_case(kernel_cli_path, manifest_cli_path, merkle_cli_path)
    out_dir = export_bundle(case, tmp_path / "bundle", merkle_cli_path)

    script = textwrap.dedent(
        f"""
        import sys
        from pathlib import Path
        from attesta_adjudicate.export_bundle import verify_bundle

        result = verify_bundle(
            Path({str(out_dir)!r}),
            Path({str(kernel_cli_path)!r}),
            Path({str(manifest_cli_path)!r}),
            Path({str(merkle_cli_path)!r}),
        )
        sys.exit(0 if result.ok else 1)
        """
    )
    proc = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, f"stdout={proc.stdout!r} stderr={proc.stderr!r}"
