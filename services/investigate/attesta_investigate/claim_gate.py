"""The Claim Gate — docs/ARCHITECTURE.md 2.7.

"The Claim Gate rejects a claim if: evidence list is empty; any
evidence_id is absent from the pinned epoch's Merkle tree; predicate is
not in the versioned predicate registry; interval is outside the case
window."

This is invariant I2 ("no claim without evidence") enforced structurally,
not by asking a model nicely. The LLM boundary is an untrusted-input
boundary (CLAUDE.md 5): prompt injection in a log line can change what a
model WRITES, but it cannot change what the kernel ADJUDICATES, because
nothing reaches `adjudicate` without passing through `admit` first —
that's the entire mechanism the Phase 6 gate's injection test proves.
"""

from __future__ import annotations

from typing import Optional

from .models import ClaimRejected, ProposedClaim

KNOWN_PREDICATES: frozenset[str] = frozenset(
    {
        "AUTH_FAILED_BURST",
        "AUTH_SUCCEEDED_AFTER_FAILURES",
        "AUTH_FROM_NEW_ASN",
        "TOKEN_REPLAYED",
        "TRAVEL_IMPOSSIBLE",
        "INTERPRETER_SPAWNED_BY",
        "ENCODED_COMMAND",
        "INTERPRETER_NETWORK_EGRESS",
        "CONNECTED_TO_INDICATOR",
        "RDP_INTERNAL_FIRST_TIME",
        "PERSISTENCE_INSTALLED",
    }
)


class ClaimGate:
    def __init__(
        self,
        pinned_evidence_ids: set[str],
        case_window_start_ns: int,
        case_window_end_ns: int,
        known_predicates: frozenset[str] = KNOWN_PREDICATES,
    ) -> None:
        self._pinned_evidence_ids = pinned_evidence_ids
        self._window_start = case_window_start_ns
        self._window_end = case_window_end_ns
        self._known_predicates = known_predicates

    def admit(self, proposed: ProposedClaim) -> tuple[Optional[ProposedClaim], Optional[ClaimRejected]]:
        """Returns (claim, None) if admitted, or (None, rejection) if
        not — never both, never neither. Checked in the order
        docs/ARCHITECTURE.md 2.7 lists them, so a claim failing multiple
        checks is reported for the first (and most fundamental) one:
        no-evidence is a more basic problem than an out-of-window
        interval.
        """
        if not proposed.evidence:
            return None, ClaimRejected(proposed=proposed, reason="empty evidence list (invariant I2)")

        unknown_evidence = [e for e in proposed.evidence if e not in self._pinned_evidence_ids]
        if unknown_evidence:
            return None, ClaimRejected(
                proposed=proposed,
                reason=f"evidence id(s) not present in the pinned epoch: {unknown_evidence}",
            )

        if proposed.predicate not in self._known_predicates:
            return None, ClaimRejected(proposed=proposed, reason=f"predicate {proposed.predicate!r} is not in the predicate registry")

        if proposed.interval_end_ns < proposed.interval_start_ns:
            return None, ClaimRejected(proposed=proposed, reason="interval end precedes interval start")

        if proposed.interval_start_ns < self._window_start or proposed.interval_end_ns > self._window_end:
            return None, ClaimRejected(proposed=proposed, reason="interval falls outside the case window")

        return proposed, None
