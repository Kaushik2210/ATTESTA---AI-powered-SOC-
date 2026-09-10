"""Indicator-corpus versioning -- docs/PHASES.md Phase 8: "indicator-
corpus versioning" is one of the four things this phase has to build.

An `IndicatorEntry` matches a claim by exact (predicate, value) equality
against that claim's `object` field -- e.g. predicate="CONNECTED_TO_INDICATOR",
value="45.61.0.12" matches any stored claim asserting that predicate about
that IP, regardless of which case or tenant it came from. This is
deliberately coarser than a real threat-intel feed's matching logic (CIDR
ranges, domain wildcards, TLP handling) would be -- see rvd.py's module
doc comment for the full scope note -- but the versioning property itself
is real: `corpus_hash()` runs every entry through the same canonical-CBOR
+ BLAKE3 path (`manifest_cli`'s canon_hash op) every other content address
in this project uses, so two corpora are the same version if and only if
they hash the same, and a `VerdictDrift` can cite the exact corpus version
responsible for it.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from .manifest import canon_hash


class IndicatorEntry(BaseModel):
    predicate: str
    value: str  # matched against a claim's `object` field, exactly
    weight: int
    techniques: list[str] = []


class IndicatorCorpus(BaseModel):
    version: str
    entries: list[IndicatorEntry]

    def matches(self, predicate: str, value: str | None) -> IndicatorEntry | None:
        if value is None:
            return None
        for entry in self.entries:
            if entry.predicate == predicate and entry.value == value:
                return entry
        return None


def corpus_hash(corpus: IndicatorCorpus, manifest_cli_path: Path) -> str:
    """Content address for a corpus snapshot -- same canon_hash op
    manifest.py's `claim_set_hash` computation uses, applied here to the
    corpus's own content instead of a claim set. Two corpora with
    identical entries (any order) hash identically: entries are sorted by
    their own canonical form before hashing, the same "canonicalize away
    accidental ordering" discipline this project applies everywhere else
    a content address is computed from a list.
    """
    ordered = sorted(
        (e.model_dump(mode="json") for e in corpus.entries),
        key=lambda e: (e["predicate"], e["value"]),
    )
    return canon_hash({"version": corpus.version, "entries": ordered}, manifest_cli_path)
