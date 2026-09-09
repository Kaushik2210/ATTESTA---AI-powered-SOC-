from attesta_investigate.claim_gate import ClaimGate
from attesta_investigate.investigator import Budget, run_investigation
from attesta_investigate.models import Extractor, ExtractorKind, ProposedClaim
from attesta_investigate.provider import AlwaysToolCallingProvider, FakeScriptedProvider, ProviderTurn, ToolCall


def make_gate() -> ClaimGate:
    return ClaimGate(pinned_evidence_ids={"blake3:ev1"}, case_window_start_ns=0, case_window_end_ns=1000)


def make_claim(hypothesis_ref: str | None = None) -> ProposedClaim:
    return ProposedClaim(
        predicate="AUTH_FAILED_BURST",
        subject="user:jdoe",
        interval_start_ns=0,
        interval_end_ns=100,
        evidence=["blake3:ev1"],
        extractor=Extractor(kind=ExtractorKind.RULE, id="x", version="1"),
        hypothesis_ref=hypothesis_ref,
    )


def test_investigation_concludes_when_provider_stops_proposing_tool_calls() -> None:
    provider = FakeScriptedProvider(model_id="fake-a", script=[ProviderTurn(proposed_claims=[make_claim()])])
    result = run_investigation("evidence", provider, make_gate())
    assert result.budget_exhausted is False
    assert len(result.accepted_claims) == 1


def test_budget_exhaustion_is_flagged_not_silently_ignored() -> None:
    # docs/ARCHITECTURE.md 2.6: "Exceeding any budget yields a partial
    # claim set and an INCOMPLETE verdict, never a guess." A provider
    # that never stops proposing tool calls must hit the bound, not loop
    # forever or silently truncate.
    provider = AlwaysToolCallingProvider()
    budget = Budget(max_tool_calls=5, max_turns=100)
    result = run_investigation("evidence", provider, make_gate(), budget)
    assert result.budget_exhausted is True


def test_budget_exhaustion_still_returns_whatever_was_gathered() -> None:
    provider = FakeScriptedProvider(
        model_id="fake-a",
        script=[
            ProviderTurn(proposed_claims=[make_claim()], tool_calls=[ToolCall(name="fetch_evidence")]),
            ProviderTurn(tool_calls=[ToolCall(name="fetch_evidence")]),
        ],
    )
    budget = Budget(max_tool_calls=1, max_turns=100)
    result = run_investigation("evidence", provider, make_gate(), budget)
    assert result.budget_exhausted is True
    assert len(result.accepted_claims) == 1  # gathered before the budget ran out -- not discarded


def test_multi_hypothesis_satisfied_reflects_actual_hypothesis_refs_seen() -> None:
    provider = FakeScriptedProvider(
        model_id="fake-a",
        script=[ProviderTurn(proposed_claims=[make_claim("H1"), make_claim("H2")])],
    )
    result = run_investigation("evidence", provider, make_gate())
    assert result.multi_hypothesis_satisfied is True


def test_multi_hypothesis_not_satisfied_with_only_one_hypothesis() -> None:
    provider = FakeScriptedProvider(model_id="fake-a", script=[ProviderTurn(proposed_claims=[make_claim("H1")])])
    result = run_investigation("evidence", provider, make_gate())
    assert result.multi_hypothesis_satisfied is False
