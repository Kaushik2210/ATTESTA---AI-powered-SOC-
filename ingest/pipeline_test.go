package ingest

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/Kaushik2210/attesta/ledger"
)

func loadCorpus(t *testing.T, name string) [][]byte {
	t.Helper()
	path := filepath.Join(repoRoot(t), "testdata", "corpus", name)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading corpus %s: %v", path, err)
	}
	return bytes.Split(bytes.TrimRight(data, "\n"), []byte("\n"))
}

// TestReplayCorpus_ByteIdenticalAcrossTwoRuns is the Phase 2 gate's replay
// requirement, applied at the ingest layer: "replay a recorded pcap/log
// corpus through the pipeline twice; byte-identical evidence sets"
// (phases/PHASES.md).
func TestReplayCorpus_ByteIdenticalAcrossTwoRuns(t *testing.T) {
	for _, tc := range []struct {
		mappingFile string
		corpusFile  string
	}{
		{"cloudtrail.ocsf.yaml", "cloudtrail_sample.jsonl"},
		{"entra_signin.ocsf.yaml", "entra_signin_sample.jsonl"},
	} {
		t.Run(tc.corpusFile, func(t *testing.T) {
			mapping := loadTestMapping(t, tc.mappingFile)
			lines := loadCorpus(t, tc.corpusFile)

			store1 := ledger.NewStore()
			ids1, err := ReplayCorpus(store1, mapping, lines)
			if err != nil {
				t.Fatalf("first replay: %v", err)
			}

			store2 := ledger.NewStore()
			ids2, err := ReplayCorpus(store2, mapping, lines)
			if err != nil {
				t.Fatalf("second replay: %v", err)
			}

			if len(ids1) != len(ids2) {
				t.Fatalf("replay produced different counts: %d vs %d", len(ids1), len(ids2))
			}
			for i := range ids1 {
				if ids1[i] != ids2[i] {
					t.Fatalf("line %d: EvidenceID differs across replays: %s vs %s", i, ids1[i], ids2[i])
				}
			}
		})
	}
}

// TestReplayCorpus_ReingestIntoSameStoreAddsNoNewNodes proves append-only
// dedup at the ingest layer: replaying the identical corpus into the SAME
// store a second time must not grow it.
func TestReplayCorpus_ReingestIntoSameStoreAddsNoNewNodes(t *testing.T) {
	mapping := loadTestMapping(t, "cloudtrail.ocsf.yaml")
	lines := loadCorpus(t, "cloudtrail_sample.jsonl")
	store := ledger.NewStore()

	ids1, err := ReplayCorpus(store, mapping, lines)
	if err != nil {
		t.Fatal(err)
	}
	afterFirst := store.Len()
	if afterFirst == 0 {
		t.Fatal("expected at least one node after the first replay")
	}

	ids2, err := ReplayCorpus(store, mapping, lines)
	if err != nil {
		t.Fatal(err)
	}
	afterSecond := store.Len()

	if afterSecond != afterFirst {
		t.Fatalf("re-ingesting the identical corpus changed the store size: %d -> %d", afterFirst, afterSecond)
	}
	for i := range ids1 {
		if ids1[i] != ids2[i] {
			t.Fatalf("line %d: re-ingest produced a different EvidenceID", i)
		}
	}
}

// TestMappingVersionChange_ProducesNewNodeNotMutation is the Phase 2
// gate's third requirement: "Mapping-version change produces new nodes,
// never mutations" (phases/PHASES.md).
func TestMappingVersionChange_ProducesNewNodeNotMutation(t *testing.T) {
	v1 := loadTestMapping(t, "cloudtrail.ocsf.yaml")

	// A v2 mapping: identical field derivations, only the version bumped
	// -- exactly the scenario ARCHITECTURE.md 2.2 describes ("a mapping
	// change produces new evidence nodes rather than silently mutating
	// history").
	v2 := &Mapping{
		SourceID:            v1.SourceID,
		MappingVersion:      "2",
		SchemaVersion:       v1.SchemaVersion,
		Fields:              v1.Fields,
		UnmappedPassthrough: v1.UnmappedPassthrough,
	}

	lines := loadCorpus(t, "cloudtrail_sample.jsonl")
	raw, err := decodeJSONLine(lines[0])
	if err != nil {
		t.Fatal(err)
	}

	store := ledger.NewStore()

	normalized1, err := v1.Apply(raw)
	if err != nil {
		t.Fatal(err)
	}
	id1, err := store.Put(normalized1)
	if err != nil {
		t.Fatal(err)
	}

	normalized2, err := v2.Apply(raw)
	if err != nil {
		t.Fatal(err)
	}
	id2, err := store.Put(normalized2)
	if err != nil {
		t.Fatal(err)
	}

	if id1 == id2 {
		t.Fatal("a mapping-version change produced the SAME EvidenceID — it must produce a new node")
	}

	// Both nodes must coexist -- the v1 node was never mutated or
	// replaced by the v2 write.
	if _, err := store.Get(id1); err != nil {
		t.Fatalf("v1 node no longer retrievable after the v2 write: %v", err)
	}
	if _, err := store.Get(id2); err != nil {
		t.Fatalf("v2 node not retrievable: %v", err)
	}
	if store.Len() != 2 {
		t.Fatalf("expected exactly 2 distinct nodes, store has %d", store.Len())
	}
}
