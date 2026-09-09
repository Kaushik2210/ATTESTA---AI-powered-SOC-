"""InvestigationManifest (docs/ARCHITECTURE.md 2.9) and the subprocess
bridges to ledger/cmd/manifest_cli and ledger/cmd/merkle_cli -- the
Go-side counterparts of adjudicate_bridge.py's bridge to the Rust kernel.
Canonical CBOR encoding, BLAKE3 content addressing, and Ed25519 signing
all live in ledger/ (Go), same as every other evidence-path primitive in
this project; this module is the only place that has to know the two
CLIs' JSON shapes, exactly the discipline adjudicate_bridge.py already
established for the kernel.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel

ZERO_HASH = ""  # the documented "unset" sentinel manifest_cli's decodeHex32 accepts


class InferenceMeta(BaseModel):
    provider: str
    model_id: str
    weights_digest: str
    seed: Optional[int] = None
    decode_params: dict[str, str] = {}
    prompt_template_hashes: list[str] = []
    tool_versions: dict[str, str] = {}


class BudgetConsumed(BaseModel):
    tool_calls: int
    turns: int


class Manifest(BaseModel):
    investigation_id: str
    tenant_id: str
    case_id: str
    epoch_root: str = ZERO_HASH
    epoch_id: int = 0
    index_snapshot_hash: str = ZERO_HASH
    claim_set_hash: str
    claim_ids: list[str]
    inference: InferenceMeta
    policy_version: str
    kernel_version: str
    attack_model_version: str = "attack.unversioned"
    verdict_severity: str
    verdict_confidence: int
    verdict_disposition: str
    verdict_hash: str
    budget_consumed: BudgetConsumed
    started_at_ns: int
    completed_at_ns: int
    prev_manifest_hash: str = ZERO_HASH


class SealedManifest(BaseModel):
    manifest: Manifest
    manifest_hash: str
    signature: str
    public_key: str


class LedgerBridgeError(RuntimeError):
    pass


def find_go_cli(repo_root: Path, name: str) -> Path:
    names = [name, f"{name}.exe"]
    for profile in ("release", "debug"):
        for candidate_name in names:
            candidate = repo_root / "target" / profile / candidate_name
            if candidate.exists():
                return candidate
    raise FileNotFoundError(
        f"{name} binary not found under target/{{release,debug}}/ -- "
        f"run `go build -o target/release/{name} ./ledger/cmd/{name}` first"
    )


def _run_cli(cli_path: Path, request: dict[str, Any]) -> dict[str, Any]:
    proc = subprocess.run(
        [str(cli_path)],
        input=json.dumps(request),
        capture_output=True,
        text=True,
        timeout=30,
    )
    try:
        output = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise LedgerBridgeError(
            f"{cli_path.name} produced non-JSON output (exit {proc.returncode}): "
            f"stdout={proc.stdout!r} stderr={proc.stderr!r}"
        ) from e
    if proc.returncode != 0:
        raise LedgerBridgeError(f"{cli_path.name} rejected the request: {output.get('error', proc.stderr)}")
    return output


def seal_manifest(manifest: Manifest, signing_key_seed_hex: str, manifest_cli_path: Path) -> SealedManifest:
    """Canonicalizes, hashes, and signs `manifest` via manifest_cli. The
    caller is responsible for setting manifest.prev_manifest_hash to the
    tenant's current chain tip before calling this -- see store.py's
    ManifestStore, which owns that bookkeeping so this function can stay a
    thin, stateless bridge, matching ledger.SealManifest's own purity on
    the Go side.
    """
    result = _run_cli(
        manifest_cli_path,
        {"op": "seal", "signing_key_seed": signing_key_seed_hex, "manifest": manifest.model_dump(mode="json")},
    )
    return SealedManifest(
        manifest=manifest,
        manifest_hash=result["manifest_hash"],
        signature=result["signature"],
        public_key=result["public_key"],
    )


def verify_sealed_manifest(sealed: SealedManifest, manifest_cli_path: Path) -> bool:
    """Re-derives the manifest's hash from its own fields and checks both
    the hash and the Ed25519 signature -- the exact check a third party
    runs against an exported bundle with no access to any of ATTESTA's own
    systems. Never trusts `sealed.manifest_hash` at face value: it is
    recomputed from `sealed.manifest` inside manifest_cli itself.
    """
    result = _run_cli(
        manifest_cli_path,
        {
            "op": "verify",
            "manifest": sealed.manifest.model_dump(mode="json"),
            "manifest_hash": sealed.manifest_hash,
            "signature": sealed.signature,
            "public_key": sealed.public_key,
        },
    )
    return bool(result["valid"])


def canon_hash(value: Any, manifest_cli_path: Path) -> str:
    """Canonicalizes and BLAKE3-hashes an arbitrary JSON-serializable
    value via manifest_cli's "canon_hash" op -- used for
    Manifest.claim_set_hash, which commits to the submitted claim set as a
    single content address independent of the kernel's own per-claim
    claim_id() (see kernel/src/bin/adjudicate_cli.rs's
    `submitted_claim_ids`, a separate, complementary identity).
    """
    result = _run_cli(manifest_cli_path, {"op": "canon_hash", "value": value})
    return str(result["hash"])


class MerkleProofStep(BaseModel):
    hash: str
    is_left: bool


class InclusionProof(BaseModel):
    leaf_index: int
    steps: list[MerkleProofStep]
    root: str


def merkle_prove(evidence_ids: list[str], leaf_index: int, merkle_cli_path: Path) -> InclusionProof:
    result = _run_cli(merkle_cli_path, {"op": "prove", "evidence_ids": evidence_ids, "leaf_index": leaf_index})
    return InclusionProof(
        leaf_index=result["leaf_index"],
        steps=[MerkleProofStep(**s) for s in result["steps"]],
        root=result["root"],
    )


def merkle_verify(evidence_id: str, proof: InclusionProof, root: str, merkle_cli_path: Path) -> bool:
    result = _run_cli(
        merkle_cli_path,
        {
            "op": "verify",
            "evidence_id": evidence_id,
            "leaf_index": proof.leaf_index,
            "steps": [s.model_dump() for s in proof.steps],
            "root": root,
        },
    )
    return bool(result["valid"])
