"""The Investigator loop — docs/ARCHITECTURE.md 2.6: a constrained agent
loop whose only outputs are typed Claims, bounded by a tool budget, and
subject to multi-hypothesis discipline.
"""

from __future__ import annotations

import dataclasses
from typing import Any, Optional

from .claim_gate import ClaimGate
from .models import ClaimRejected, ProposedClaim
from .provider import InferenceProvider


@dataclasses.dataclass
class Budget:
    """docs/ARCHITECTURE.md 2.6: "Bounded tool budget per investigation
    (default 24 calls), bounded wall clock, bounded token spend.
    Exceeding any budget yields a partial claim set and an INCOMPLETE
    verdict, never a guess." Wall-clock and token budgets are natural
    extensions of the same `budget_exhausted` mechanism below (both
    reduce to "stop and mark incomplete"); only the tool-call budget is
    enforced in this phase, since it's the one every fixture actually
    needs.
    """

    max_tool_calls: int = 24
    max_turns: int = 10


@dataclasses.dataclass
class InvestigationResult:
    accepted_claims: list[ProposedClaim]
    rejected: list[ClaimRejected]
    budget_exhausted: bool
    hypothesis_refs_seen: frozenset[str]

    @property
    def multi_hypothesis_satisfied(self) -> bool:
        """docs/ARCHITECTURE.md 2.6: "the investigator is required to
        instantiate at least two competing hypotheses ... before
        concluding." Surfaced here as a fact about what happened, not
        enforced as a hard gate on completion — a real deployment would
        use this to decide whether to re-prompt for a second hypothesis
        before accepting the investigation as done; that prompting
        strategy is a later refinement, not this property's definition.
        """
        return len(self.hypothesis_refs_seen) >= 2


def run_investigation(
    evidence_context: str,
    provider: InferenceProvider,
    gate: ClaimGate,
    budget: Optional[Budget] = None,
) -> InvestigationResult:
    """Runs `provider` in a loop, feeding evidence and prior tool results,
    collecting proposed claims and passing each through `gate` before it
    counts as accepted. Stops when a turn proposes no further tool calls,
    or when `budget` is exhausted — whichever comes first.
    """
    if budget is None:
        budget = Budget()

    accepted: list[ProposedClaim] = []
    rejected: list[ClaimRejected] = []
    tool_results: list[dict[str, Any]] = []
    tool_calls_made = 0
    hypotheses: set[str] = set()

    for _turn_index in range(budget.max_turns):
        turn = provider.turn(evidence_context, tool_results)

        for claim in turn.proposed_claims:
            if claim.hypothesis_ref:
                hypotheses.add(claim.hypothesis_ref)
            admitted, rejection = gate.admit(claim)
            if admitted is not None:
                accepted.append(admitted)
            else:
                assert rejection is not None
                rejected.append(rejection)

        if not turn.tool_calls:
            return InvestigationResult(
                accepted_claims=accepted,
                rejected=rejected,
                budget_exhausted=False,
                hypothesis_refs_seen=frozenset(hypotheses),
            )

        for _call in turn.tool_calls:
            tool_calls_made += 1
            if tool_calls_made > budget.max_tool_calls:
                return InvestigationResult(
                    accepted_claims=accepted,
                    rejected=rejected,
                    budget_exhausted=True,
                    hypothesis_refs_seen=frozenset(hypotheses),
                )
            # A real Source implementation would execute the named tool
            # (fetch_evidence, entity_profile, ...) against the ledger
            # and return its real result. Stubbed here: this phase's
            # scope is the gate/budget/injection properties, not the
            # full nine-tool roster docs/ARCHITECTURE.md 2.6 lists — see
            # phases/reports/PHASE-06.md.
            tool_results.append({"tool": _call.name, "result": "stub-result"})

    return InvestigationResult(
        accepted_claims=accepted,
        rejected=rejected,
        budget_exhausted=True,
        hypothesis_refs_seen=frozenset(hypotheses),
    )
