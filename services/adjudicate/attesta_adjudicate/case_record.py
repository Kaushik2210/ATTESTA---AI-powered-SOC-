"""CaseRecord: everything a closed investigation needs to be replayed,
re-derived, or exported -- the working set docs/ARCHITECTURE.md 2.10's
Replay Executor and 2.9's export bundle both operate on. Building one is
the "close a case" step: adjudicate the accepted claim set for real, then
seal an InvestigationManifest that commits to exactly what was submitted.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from attesta_investigate.adjudicate_bridge import adjudicate, claim_to_json
from attesta_investigate.models import ProposedClaim
from pydantic import BaseModel

from .manifest import BudgetConsumed, InferenceMeta, Manifest, SealedManifest, canon_hash, merkle_prove, seal_manifest


class CaseRecord(BaseModel):
    """A closed investigation, immutable once built -- invariant I3's
    append-only discipline applied at the manifest layer, not just the
    evidence layer.
    """

    tenant_id: str
    case_id: str
    investigation_id: str
    claims: list[dict[str, Any]]  # exactly what was submitted to the kernel, in submission order
    policy: dict[str, Any]
    kernel_version: str
    verdict: dict[str, Any]  # adjudicate_bridge.adjudicate()'s raw output
    sealed_manifest: SealedManifest
    evidence_ids: list[str]  # every evidence id cited by any claim, de-duplicated, sorted


def _claim_set_hash(claims_json: list[dict[str, Any]], manifest_cli_path: Path) -> str:
    """Hashes the submitted claim set in a canonical (content-sorted)
    order, so ClaimSetHash -- unlike the raw submission list order, which
    is an accident of however the caller happened to iterate -- doesn't
    depend on it. Mirrors the same "canonicalize away accidental
    ordering" discipline Claim::claim_id() applies to a single claim's
    evidence list (kernel/src/claim.rs) and BuildMerkleTree applies to a
    batch (ledger/merkle.go): only the content should ever affect a
    content address.
    """
    ordered = sorted(claims_json, key=lambda c: json.dumps(c, sort_keys=True))
    return canon_hash(ordered, manifest_cli_path)


def build_case_record(
    *,
    tenant_id: str,
    case_id: str,
    investigation_id: str,
    accepted_claims: list[ProposedClaim],
    policy: dict[str, Any],
    kernel_version: str,
    inference: InferenceMeta,
    budget_consumed: BudgetConsumed,
    started_at_ns: int,
    completed_at_ns: int,
    prev_manifest_hash: str,
    signing_key_seed_hex: str,
    kernel_cli_path: Path,
    manifest_cli_path: Path,
    merkle_cli_path: Path,
    epoch_id: int = 1,
) -> CaseRecord:
    """Runs the real kernel over `accepted_claims` (already past the Claim
    Gate -- see services/investigate), seals the resulting verdict into a
    signed, chained InvestigationManifest, and returns the complete
    CaseRecord. `prev_manifest_hash` is the caller's responsibility (see
    store.ManifestStore) so this function stays a straightforward
    orchestration step, not a place where chain state is hidden.

    `epoch_id` defaults to 1 and `epoch_root` is computed by sealing this
    case's own cited evidence into a single Merkle batch -- a documented
    simplification of docs/ARCHITECTURE.md 2.3's real hourly, cross-tenant
    epoch scheduler (which needs a live streaming ingest pipeline this
    environment doesn't run yet). What this phase's gate actually needs —
    that a manifest's epoch_root is a real Merkle root a real inclusion
    proof verifies against — holds regardless of how many cases share a
    batch.
    """
    claims_json = [claim_to_json(c) for c in accepted_claims]
    verdict = adjudicate(accepted_claims, policy, kernel_version, kernel_cli_path=kernel_cli_path)
    claim_set_hash = _claim_set_hash(claims_json, manifest_cli_path)

    evidence_ids = sorted({e for c in accepted_claims for e in c.evidence})
    epoch_root = ""
    if evidence_ids:
        epoch_root = merkle_prove(evidence_ids, 0, merkle_cli_path).root

    manifest = Manifest(
        investigation_id=investigation_id,
        tenant_id=tenant_id,
        case_id=case_id,
        epoch_root=epoch_root,
        epoch_id=epoch_id,
        claim_set_hash=claim_set_hash,
        claim_ids=verdict["submitted_claim_ids"],
        inference=inference,
        policy_version=verdict["policy_version"],
        kernel_version=verdict["kernel_version"],
        verdict_severity=verdict["severity"],
        verdict_confidence=verdict["confidence"],
        verdict_disposition=verdict["disposition"],
        verdict_hash=verdict["verdict_hash"],
        budget_consumed=budget_consumed,
        started_at_ns=started_at_ns,
        completed_at_ns=completed_at_ns,
        prev_manifest_hash=prev_manifest_hash,
    )

    sealed = seal_manifest(manifest, signing_key_seed_hex, manifest_cli_path)

    return CaseRecord(
        tenant_id=tenant_id,
        case_id=case_id,
        investigation_id=investigation_id,
        claims=claims_json,
        policy=policy,
        kernel_version=kernel_version,
        verdict=verdict,
        sealed_manifest=sealed,
        evidence_ids=evidence_ids,
    )
