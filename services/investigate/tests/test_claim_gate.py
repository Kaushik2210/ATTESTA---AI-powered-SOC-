from attesta_investigate.claim_gate import ClaimGate
from attesta_investigate.models import Extractor, ExtractorKind, ProposedClaim


def make_claim(**overrides: object) -> ProposedClaim:
    defaults: dict[str, object] = dict(
        predicate="AUTH_FAILED_BURST",
        subject="user:jdoe",
        interval_start_ns=100,
        interval_end_ns=200,
        evidence=["blake3:ev1"],
        extractor=Extractor(kind=ExtractorKind.RULE, id="x", version="1"),
    )
    defaults.update(overrides)
    return ProposedClaim(**defaults)  # type: ignore[arg-type]


def make_gate() -> ClaimGate:
    return ClaimGate(pinned_evidence_ids={"blake3:ev1", "blake3:ev2"}, case_window_start_ns=0, case_window_end_ns=1000)


def test_admits_a_valid_claim() -> None:
    gate = make_gate()
    admitted, rejected = gate.admit(make_claim())
    assert admitted is not None
    assert rejected is None


def test_rejects_empty_evidence() -> None:
    gate = make_gate()
    admitted, rejected = gate.admit(make_claim(evidence=[]))
    assert admitted is None
    assert rejected is not None
    assert "evidence" in rejected.reason.lower()


def test_rejects_evidence_not_in_pinned_epoch() -> None:
    gate = make_gate()
    admitted, rejected = gate.admit(make_claim(evidence=["blake3:fabricated"]))
    assert admitted is None
    assert rejected is not None
    assert "pinned epoch" in rejected.reason


def test_rejects_unknown_predicate() -> None:
    gate = make_gate()
    admitted, rejected = gate.admit(make_claim(predicate="MARK_BENIGN_OVERRIDE"))
    assert admitted is None
    assert rejected is not None
    assert "predicate" in rejected.reason.lower()


def test_rejects_interval_outside_window() -> None:
    gate = make_gate()
    admitted, rejected = gate.admit(make_claim(interval_start_ns=2000, interval_end_ns=2100))
    assert admitted is None
    assert rejected is not None
    assert "window" in rejected.reason.lower()


def test_rejects_inverted_interval() -> None:
    gate = make_gate()
    admitted, rejected = gate.admit(make_claim(interval_start_ns=500, interval_end_ns=100))
    assert admitted is None
    assert rejected is not None
    assert "precedes" in rejected.reason.lower()


def test_partial_evidence_overlap_is_still_rejected() -> None:
    # One real id and one fabricated id -- the fabricated one alone must
    # be enough to reject the whole claim (I2 requires EVERY cited hash
    # to resolve, not merely at least one).
    gate = make_gate()
    admitted, rejected = gate.admit(make_claim(evidence=["blake3:ev1", "blake3:fabricated"]))
    assert admitted is None
    assert rejected is not None
