"""Pydantic models at every boundary (CLAUDE.md 4) for the Investigator
and Claim Gate. `ProposedClaim` is deliberately the untrusted shape: it's
what a model's output parses into, before `ClaimGate.admit` decides
whether it ever becomes something the kernel will see.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

import pydantic


class Polarity(str, Enum):
    SUPPORTS = "supports"
    REFUTES = "refutes"


class ExtractorKind(str, Enum):
    RULE = "rule"
    STAT = "stat"
    MODEL = "model"
    LLM = "llm"


class Extractor(pydantic.BaseModel):
    kind: ExtractorKind
    id: str
    version: str


class ProposedClaim(pydantic.BaseModel):
    """What the Investigator's tool layer receives from a provider —
    untrusted input. docs/ARCHITECTURE.md 2.7's Claim schema, in the
    shape it takes before the Claim Gate has validated it against
    invariant I2.
    """

    predicate: str
    subject: str
    object: Optional[str] = None
    interval_start_ns: int
    interval_end_ns: int
    evidence: list[str] = pydantic.Field(default_factory=list)
    extractor: Extractor
    observed_value: Optional[int] = None
    polarity: Polarity = Polarity.SUPPORTS
    hypothesis_ref: Optional[str] = None


class ClaimRejected(pydantic.BaseModel):
    """docs/ARCHITECTURE.md 2.7: "Rejections are logged as ClaimRejected
    events — an unusual spike in rejections is itself a detection
    signal (it can indicate injection attempts)." This is the Phase 6
    gate's requirement (c) made concrete: a real, inspectable record,
    not just a dropped value.
    """

    proposed: ProposedClaim
    reason: str
