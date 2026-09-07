package ledger

import (
	"encoding/binary"
	"math/rand"
	"testing"
)

// randomEvent builds a synthetic-but-representative event: bounded depth,
// mixed types, always Go's native map[string]any (whose iteration order is
// deliberately randomized by the runtime) so repeated encoding genuinely
// exercises whether our own explicit sort -- not accidental map order --
// is what makes the output deterministic.
func randomEvent(r *rand.Rand) map[string]any {
	fieldCount := 3 + r.Intn(8)
	m := make(map[string]any, fieldCount+3)
	m["schema_version"] = "1.0.0"
	m["source_id"] = randomString(r, 4+r.Intn(12))
	m["timestamp_ns"] = int64(r.Uint64() >> 1) // keep positive-ish, still exercises full range elsewhere
	for i := 0; i < fieldCount; i++ {
		key := randomString(r, 1+r.Intn(10))
		m[key] = randomValue(r, 0)
	}
	return m
}

func randomValue(r *rand.Rand, depth int) any {
	if depth > 2 {
		return randomString(r, 1+r.Intn(8))
	}
	switch r.Intn(6) {
	case 0:
		return int64(r.Uint64())
	case 1:
		return -int64(r.Uint64() >> 1)
	case 2:
		return randomString(r, r.Intn(16))
	case 3:
		return r.Intn(2) == 0
	case 4:
		n := r.Intn(4)
		arr := make([]any, n)
		for i := range arr {
			arr[i] = randomValue(r, depth+1)
		}
		return arr
	case 5:
		n := r.Intn(4)
		mp := make(map[string]any, n)
		for i := 0; i < n; i++ {
			mp[randomString(r, 1+r.Intn(6))] = randomValue(r, depth+1)
		}
		return mp
	default:
		return nil
	}
}

const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"

func randomString(r *rand.Rand, n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = alphabet[r.Intn(len(alphabet))]
	}
	return string(b)
}

// TestCanonicalEncoding_IsDeterministicUnderRepeatedEncoding is the Phase 1
// exit-gate property test (phases/PHASES.md): 10,000 randomly generated
// events, each encoded repeatedly, must produce byte-identical output (and
// therefore byte-identical EvidenceID) every single time, despite Go's map
// iteration order being randomized per-process. `go test -short` runs a
// reduced pass (documented in phases/reports/PHASE-01.md) to keep local
// iteration fast; the full 10,000x1000 pass runs in CI.
func TestCanonicalEncoding_IsDeterministicUnderRepeatedEncoding(t *testing.T) {
	eventCount := 10000
	repeats := 1000
	if testing.Short() {
		eventCount = 200
		repeats = 50
	}

	seed := int64(20260907) // fixed seed: this test's INPUTS must also be
	// reproducible across runs/machines, or a failure would be unable to
	// tell you which event broke.
	r := rand.New(rand.NewSource(seed))

	for e := 0; e < eventCount; e++ {
		event := randomEvent(r)

		var firstCanonical []byte
		var firstID EvidenceID
		for i := 0; i < repeats; i++ {
			id, canonical, err := NewEvidenceID(event)
			if err != nil {
				t.Fatalf("event %d: NewEvidenceID error on iteration %d: %v", e, i, err)
			}
			if i == 0 {
				firstCanonical = canonical
				firstID = id
				continue
			}
			if id != firstID {
				t.Fatalf("event %d: EvidenceID drifted at iteration %d — canonicalization is not deterministic under Go's randomized map iteration", e, i)
			}
			if string(canonical) != string(firstCanonical) {
				t.Fatalf("event %d: canonical bytes drifted at iteration %d", e, i)
			}
		}
	}
}

// TestCanonicalEncoding_SameLogicalEventFromDifferentMapConstructionOrder
// builds the identical field set via two different insertion orders (Go
// map literals don't guarantee construction order affects iteration order
// anyway, but this makes the intent explicit and adds a second, cheap
// signal alongside the property test above).
func TestCanonicalEncoding_SameLogicalEventFromDifferentMapConstructionOrder(t *testing.T) {
	a := map[string]any{"alpha": int64(1), "beta": int64(2), "gamma": int64(3)}
	b := map[string]any{"gamma": int64(3), "alpha": int64(1), "beta": int64(2)}

	idA, canonA, err := NewEvidenceID(a)
	if err != nil {
		t.Fatal(err)
	}
	idB, canonB, err := NewEvidenceID(b)
	if err != nil {
		t.Fatal(err)
	}
	if idA != idB {
		t.Fatalf("same logical event produced different IDs depending on construction order: %s vs %s", idA, idB)
	}
	if string(canonA) != string(canonB) {
		t.Fatal("same logical event produced different canonical bytes depending on construction order")
	}
}

// sanity check that the random-timestamp field doesn't accidentally emit a
// value our encoder rejects (e.g. never negative-overflowing int64).
func TestRandomEvent_TimestampAlwaysEncodable(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	for i := 0; i < 1000; i++ {
		ev := randomEvent(r)
		ts, ok := ev["timestamp_ns"].(int64)
		if !ok || ts < 0 {
			t.Fatalf("unexpected timestamp field: %#v", ev["timestamp_ns"])
		}
		var b [8]byte
		binary.BigEndian.PutUint64(b[:], uint64(ts))
	}
}
