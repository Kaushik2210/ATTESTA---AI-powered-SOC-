"""ManifestStore: per-tenant hash-chain bookkeeping and the closed-case
index docs/ARCHITECTURE.md 2.11's RVD sweep pseudocode calls
`closed_investigations(window)`. In-memory only in this phase -- a real
deployment persists this in the control-plane database (Phase 12), but
the chaining and lookup semantics a persistent store must honor are
exactly what this class gets right first.
"""

from __future__ import annotations

from pathlib import Path

from .case_record import CaseRecord, build_case_record
from .manifest import BudgetConsumed, InferenceMeta
from attesta_investigate.models import ProposedClaim
from typing import Any


class ManifestStore:
    """Owns the one piece of mutable state manifest sealing needs: each
    tenant's current chain tip. `manifest.seal_manifest` itself stays a
    pure function (mirroring `ledger.SealManifest` on the Go side) --
    this class is where that purity gets threaded into an actual chain,
    the same separation epoch.go's SealEpoch draws between computing a
    seal and a caller tracking `prev` across calls.
    """

    def __init__(self) -> None:
        self._chain_tip: dict[str, str] = {}
        self._cases: dict[str, CaseRecord] = {}
        # case_id -> whatever the caller passes to mark_reopened (an
        # rvd.VerdictDrift in practice). Typed Any rather than imported
        # from rvd.py to avoid a store.py <-> rvd.py import cycle: rvd.py
        # already needs ManifestStore to run a sweep over.
        self._reopened: dict[str, Any] = {}

    def close_case(
        self,
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
        signing_key_seed_hex: str,
        kernel_cli_path: Path,
        manifest_cli_path: Path,
        merkle_cli_path: Path,
    ) -> CaseRecord:
        prev = self._chain_tip.get(tenant_id, "")
        record = build_case_record(
            tenant_id=tenant_id,
            case_id=case_id,
            investigation_id=investigation_id,
            accepted_claims=accepted_claims,
            policy=policy,
            kernel_version=kernel_version,
            inference=inference,
            budget_consumed=budget_consumed,
            started_at_ns=started_at_ns,
            completed_at_ns=completed_at_ns,
            prev_manifest_hash=prev,
            signing_key_seed_hex=signing_key_seed_hex,
            kernel_cli_path=kernel_cli_path,
            manifest_cli_path=manifest_cli_path,
            merkle_cli_path=merkle_cli_path,
        )
        self._chain_tip[tenant_id] = record.sealed_manifest.manifest_hash
        self._cases[case_id] = record
        return record

    def get(self, case_id: str) -> CaseRecord:
        return self._cases[case_id]

    def closed_investigations(self) -> list[CaseRecord]:
        """All closed cases, in insertion order. No time-window filter
        yet -- docs/ARCHITECTURE.md 2.11's `closed_investigations(window)`
        is Phase 8's RVD sweep; this phase only needs the underlying
        index to exist and be honest about what it returns.
        """
        return list(self._cases.values())

    def chain_tip(self, tenant_id: str) -> str:
        return self._chain_tip.get(tenant_id, "")

    def mark_reopened(self, case_id: str, drift: Any) -> None:
        """The reopen workflow docs/PHASES.md's Phase 8 gate names --
        deliberately NOT a mutation of the CaseRecord itself (that stays
        immutable, matching invariant I3's append-only discipline at the
        manifest layer). Reopening is workflow state layered on top of an
        unaltered, still independently-verifiable closed record.
        """
        self._reopened[case_id] = drift

    def is_reopened(self, case_id: str) -> bool:
        return case_id in self._reopened

    def drift_for(self, case_id: str) -> Any:
        return self._reopened.get(case_id)

    def reopened_case_ids(self) -> list[str]:
        return list(self._reopened.keys())

    def __len__(self) -> int:
        return len(self._cases)
