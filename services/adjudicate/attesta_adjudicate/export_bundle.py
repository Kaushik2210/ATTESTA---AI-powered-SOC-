"""Export bundle -- docs/ARCHITECTURE.md 2.9: "Export produces a
self-contained bundle: manifest + claim set + evidence inclusion proofs +
kernel WASM binary + policy bundle. A third party with that bundle and no
access to your systems can verify the verdict."

Scope note: the bundle here carries a reference to the *native*
adjudicate_cli binary rather than the kernel's WASM build. The kernel's
WASM export already proves (Phase 5, `phases/reports/PHASE-05.md`) that
native and WASM execution are byte-identical across architectures — the
guarantee this bundle exists to let a third party check is that the
bundle's *contents* are self-consistent and independently verifiable by
ANY compatible kernel build, which native already demonstrates without
requiring a browser. Literal in-browser WASM verification, with its own
UI affordance, is Phase 11's deliverable
(docs/ARCHITECTURE.md 2.8: "the browser downloads the kernel and the
claim set and independently recomputes verdict_hash").

`export_bundle` writes files; `verify_bundle` re-reads them from disk from
scratch (never touching the CaseRecord object that produced them) and
makes zero network calls -- the honest proxy this project can offer, in
this environment, for "verifies on a clean machine with no network
access."
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .case_record import CaseRecord
from .manifest import InclusionProof, SealedManifest, merkle_prove, merkle_verify, verify_sealed_manifest
from attesta_investigate.adjudicate_bridge import adjudicate_raw


def export_bundle(case: CaseRecord, out_dir: Path, merkle_cli_path: Path) -> Path:
    """Writes manifest.json, claims.json, policy.json, verdict.json, and
    evidence_inclusion.json into `out_dir`. Returns `out_dir`.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    (out_dir / "manifest.json").write_text(json.dumps(case.sealed_manifest.model_dump(mode="json"), indent=2))
    (out_dir / "claims.json").write_text(json.dumps(case.claims, indent=2))
    (out_dir / "policy.json").write_text(json.dumps(case.policy, indent=2))
    (out_dir / "verdict.json").write_text(json.dumps(case.verdict, indent=2))
    (out_dir / "kernel_version.txt").write_text(case.kernel_version)

    inclusion: dict[str, Any] = {"evidence_ids": case.evidence_ids, "proofs": {}}
    if case.evidence_ids:
        for i, evidence_id in enumerate(case.evidence_ids):
            proof = merkle_prove(case.evidence_ids, i, merkle_cli_path)
            inclusion["proofs"][evidence_id] = proof.model_dump(mode="json")
    (out_dir / "evidence_inclusion.json").write_text(json.dumps(inclusion, indent=2))

    return out_dir


class BundleVerificationResult:
    def __init__(
        self,
        *,
        manifest_signature_valid: bool,
        verdict_hash_matches: bool,
        evidence_inclusion_valid: bool,
        errors: list[str],
    ) -> None:
        self.manifest_signature_valid = manifest_signature_valid
        self.verdict_hash_matches = verdict_hash_matches
        self.evidence_inclusion_valid = evidence_inclusion_valid
        self.errors = errors

    @property
    def ok(self) -> bool:
        return self.manifest_signature_valid and self.verdict_hash_matches and self.evidence_inclusion_valid and not self.errors


def verify_bundle(bundle_dir: Path, kernel_cli_path: Path, manifest_cli_path: Path, merkle_cli_path: Path) -> BundleVerificationResult:
    """Independently re-verifies a bundle written by `export_bundle`,
    reading ONLY files under `bundle_dir` and using ONLY the three local
    binaries passed in -- no reference to any Python object from the
    export step, no network call anywhere in this function. This is what
    "a third party with that bundle and no access to your systems can
    verify the verdict" means, made runnable.
    """
    errors: list[str] = []

    manifest_data = json.loads((bundle_dir / "manifest.json").read_text())
    sealed = SealedManifest.model_validate(manifest_data)
    manifest_signature_valid = verify_sealed_manifest(sealed, manifest_cli_path)
    if not manifest_signature_valid:
        errors.append("manifest signature/hash did not verify")

    claims = json.loads((bundle_dir / "claims.json").read_text())
    policy = json.loads((bundle_dir / "policy.json").read_text())
    kernel_version = (bundle_dir / "kernel_version.txt").read_text()
    recomputed = adjudicate_raw(claims, policy, kernel_version, kernel_cli_path)
    verdict_hash_matches = recomputed["verdict_hash"] == sealed.manifest.verdict_hash
    if not verdict_hash_matches:
        errors.append(
            f"recomputed verdict_hash {recomputed['verdict_hash']!r} != "
            f"manifest verdict_hash {sealed.manifest.verdict_hash!r}"
        )

    inclusion = json.loads((bundle_dir / "evidence_inclusion.json").read_text())
    evidence_inclusion_valid = True
    for evidence_id, proof_data in inclusion["proofs"].items():
        proof = InclusionProof.model_validate(proof_data)
        # Two separate checks, deliberately: (1) the proof is internally
        # consistent -- it really does recompute to its own claimed root;
        # (2) that root is the SAME root the signed manifest committed to
        # as epoch_root. Checking only (1) would let a bundle carry a
        # self-consistent but disconnected inclusion proof -- a tree that
        # verifies against itself but was never the one the manifest's
        # signature actually vouches for.
        if not merkle_verify(evidence_id, proof, proof.root, merkle_cli_path):
            evidence_inclusion_valid = False
            errors.append(f"evidence inclusion proof failed to verify for {evidence_id}")
        elif proof.root != sealed.manifest.epoch_root:
            evidence_inclusion_valid = False
            errors.append(
                f"evidence inclusion proof for {evidence_id} verifies against its own root "
                f"{proof.root!r} but that root does not match the signed manifest's epoch_root "
                f"{sealed.manifest.epoch_root!r}"
            )

    return BundleVerificationResult(
        manifest_signature_valid=manifest_signature_valid,
        verdict_hash_matches=verdict_hash_matches,
        evidence_inclusion_valid=evidence_inclusion_valid,
        errors=errors,
    )
