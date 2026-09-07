package ledger

import (
	"encoding/hex"

	"lukechampine.com/blake3"
)

// EvidenceID is the content address of a canonicalized evidence event:
// BLAKE3(canonical_cbor(event)) — docs/ARCHITECTURE.md §2.2. Identical
// events from replayed sources produce the identical ID and dedupe for
// free; that's the property the determinism test in cbor_test.go and
// property_test.go exists to guarantee holds under repeated encoding.
type EvidenceID [32]byte

// String renders the ID the way the rest of the product displays it — see
// docs/UI-SPEC.md §Investigation Canvas: "a copyable blake3:... identifier".
func (id EvidenceID) String() string {
	return "blake3:" + hex.EncodeToString(id[:])
}

// HashEvidence computes the content address of an already-canonicalized
// event. Callers should almost always go through NewEvidenceID instead,
// which canonicalizes first — this is exposed separately because the
// Merkle tree also needs a plain byte-slice hashing primitive.
func HashEvidence(canonical []byte) EvidenceID {
	return EvidenceID(blake3.Sum256(canonical))
}

// NewEvidenceID canonicalizes v and returns its content address in one
// step — the normal entry point for turning a normalized event into an
// EvidenceID.
func NewEvidenceID(v any) (EvidenceID, []byte, error) {
	canonical, err := EncodeCanonical(v)
	if err != nil {
		return EvidenceID{}, nil, err
	}
	return HashEvidence(canonical), canonical, nil
}
