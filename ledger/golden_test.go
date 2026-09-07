package ledger

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

type goldenFixture struct {
	Events []struct {
		Name  string          `json:"name"`
		Value json.RawMessage `json:"value"`
	} `json:"events"`
}

type goldenVector struct {
	Name         string `json:"name"`
	CanonicalHex string `json:"canonical_hex"`
	Blake3Hex    string `json:"blake3_hex"`
}

type goldenProofStep struct {
	HashHex string `json:"hash_hex"`
	IsLeft  bool   `json:"is_left"`
}

type goldenMerkle struct {
	RootHex     string            `json:"root_hex"`
	LeafOrder   []string          `json:"leaf_order"` // event names, in the order leaves were built
	ProofLeaf0  []goldenProofStep `json:"proof_leaf_0"`
	Leaf0Verify bool              `json:"leaf_0_verifies"` // sanity flag; must be true
}

type goldenVectorsFile struct {
	Comment string         `json:"_comment"`
	Vectors []goldenVector `json:"vectors"`
	Merkle  goldenMerkle   `json:"merkle"`
}

// repoRoot walks up from this test file's package directory to find the
// repo root (identified by go.mod), so the test works regardless of the
// working directory `go test` happens to be invoked from.
func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not locate repo root (no go.mod found in any parent directory)")
		}
		dir = parent
	}
}

// jsonToCanonical converts a decoded JSON value (as produced by a decoder
// with UseNumber()) into the value shapes EncodeCanonical accepts. It
// rejects anything that isn't a whole number — this fixture format is
// deliberately float-free, matching docs/ARCHITECTURE.md §2.2.
func jsonToCanonical(v any) (any, error) {
	switch t := v.(type) {
	case nil, bool, string:
		return t, nil
	case json.Number:
		s := t.String()
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("golden fixture number %q is not a whole int64 (floats are unsupported): %w", s, err)
		}
		return n, nil
	case []any:
		out := make([]any, len(t))
		for i, item := range t {
			converted, err := jsonToCanonical(item)
			if err != nil {
				return nil, err
			}
			out[i] = converted
		}
		return out, nil
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, item := range t {
			converted, err := jsonToCanonical(item)
			if err != nil {
				return nil, err
			}
			out[k] = converted
		}
		return out, nil
	default:
		return nil, fmt.Errorf("golden fixture: unsupported JSON value type %T", v)
	}
}

func decodeJSONNumber(raw json.RawMessage) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return jsonToCanonical(v)
}

// TestGenerateGoldenVectors computes canonical-CBOR-hex and BLAKE3-hex for
// every event in testdata/golden_events.json and writes
// testdata/golden_vectors.json. ledger/verify's Rust test suite reads the
// SAME golden_events.json, recomputes independently, and asserts its
// output matches this file byte-for-byte -- that cross-implementation
// agreement is the actual proof of cross-language determinism the Phase 1
// gate (`cargo test && go test ./ledger/...`) requires; this test does not
// hardcode any expected hash value itself; it deliberately doesn't need to.
func TestGenerateGoldenVectors(t *testing.T) {
	rootDir := repoRoot(t)
	fixturePath := filepath.Join(rootDir, "testdata", "golden_events.json")
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("reading %s: %v", fixturePath, err)
	}

	var fixture goldenFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parsing %s: %v", fixturePath, err)
	}
	if len(fixture.Events) == 0 {
		t.Fatal("golden_events.json has no events")
	}

	out := goldenVectorsFile{
		Comment: "Written by ledger/golden_test.go (TestGenerateGoldenVectors). Do not hand-edit. ledger/verify's Rust tests read testdata/golden_events.json independently and must reproduce this file exactly, including the Merkle section (a tree built over the events' EvidenceIDs in fixture order).",
	}
	ids := make([]EvidenceID, 0, len(fixture.Events))
	for _, ev := range fixture.Events {
		value, err := decodeJSONNumber(ev.Value)
		if err != nil {
			t.Fatalf("event %q: %v", ev.Name, err)
		}
		id, canonical, err := NewEvidenceID(value)
		if err != nil {
			t.Fatalf("event %q: NewEvidenceID: %v", ev.Name, err)
		}
		ids = append(ids, id)
		out.Vectors = append(out.Vectors, goldenVector{
			Name:         ev.Name,
			CanonicalHex: hex.EncodeToString(canonical),
			Blake3Hex:    hex.EncodeToString(id[:]),
		})
	}

	tree, err := BuildMerkleTree(ids)
	if err != nil {
		t.Fatalf("BuildMerkleTree: %v", err)
	}
	proof0, err := tree.Prove(0)
	if err != nil {
		t.Fatalf("Prove(0): %v", err)
	}
	root := tree.Root()
	steps := make([]goldenProofStep, len(proof0.Steps))
	for i, s := range proof0.Steps {
		steps[i] = goldenProofStep{HashHex: hex.EncodeToString(s.Hash[:]), IsLeft: s.IsLeft}
	}
	leafNames := make([]string, len(fixture.Events))
	for i, ev := range fixture.Events {
		leafNames[i] = ev.Name
	}
	out.Merkle = goldenMerkle{
		RootHex:     hex.EncodeToString(root[:]),
		LeafOrder:   leafNames,
		ProofLeaf0:  steps,
		Leaf0Verify: VerifyInclusion(ids[0], proof0, root),
	}
	if !out.Merkle.Leaf0Verify {
		t.Fatal("generator's own leaf-0 proof failed to verify — refusing to write a broken fixture")
	}

	outPath := filepath.Join(rootDir, "testdata", "golden_vectors.json")
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	if err := os.WriteFile(outPath, data, 0o644); err != nil {
		t.Fatalf("writing %s: %v", outPath, err)
	}
	t.Logf("wrote %d golden vectors to %s", len(out.Vectors), outPath)

	// Re-run each event through EncodeCanonical a second time in this
	// same process as a cheap extra determinism check specific to this
	// fixture set (the exhaustive version is
	// TestCanonicalEncoding_IsDeterministicUnderRepeatedEncoding).
	for i, ev := range fixture.Events {
		value, err := decodeJSONNumber(ev.Value)
		if err != nil {
			t.Fatal(err)
		}
		id2, _, err := NewEvidenceID(value)
		if err != nil {
			t.Fatal(err)
		}
		want, err := hex.DecodeString(out.Vectors[i].Blake3Hex)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(id2[:], want) {
			t.Fatalf("event %q: re-encoding within the same process produced a different hash", ev.Name)
		}
	}
}
