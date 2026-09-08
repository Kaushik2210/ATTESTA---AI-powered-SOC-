package stats

import "testing"

func TestBaseline_IsNovel_WarmupGating(t *testing.T) {
	b := NewBaseline(3)

	// Below warm-up: absence is not yet trusted, so nothing reads as novel.
	if b.IsNovel("asn", "AS64500") {
		t.Fatal("expected IsNovel to be false before any observations (below warm-up)")
	}
	b.Observe("asn", "AS64500")
	b.Observe("asn", "AS64500")
	if b.IsNovel("asn", "AS99999") {
		t.Fatal("expected IsNovel to still be false below the warm-up threshold (2 < 3)")
	}

	// At/above warm-up: absence is now meaningful.
	b.Observe("asn", "AS64500")
	if b.IsNovel("asn", "AS64500") {
		t.Fatal("AS64500 has been observed — it should not read as novel")
	}
	if !b.IsNovel("asn", "AS99999") {
		t.Fatal("AS99999 has never been observed and warm-up is satisfied — it should read as novel")
	}
}

func TestBaseline_IsNovel_PerAttributeIndependent(t *testing.T) {
	b := NewBaseline(1)
	b.Observe("asn", "AS64500")
	// A different attribute's warm-up/seen-set is independent — no
	// observations recorded for "dst_host" yet.
	if b.IsNovel("dst_host", "AS64500") {
		t.Fatal("expected IsNovel(dst_host, ...) to be false — no dst_host observations recorded, so warm-up isn't satisfied for that attribute")
	}
}

// TestBaseline_SnapshotHash_StableAndReproducible is the Phase 4 gate's
// first requirement, verbatim: "baseline snapshot hash is stable and
// reproducible" (phases/PHASES.md). Same logical content, inserted in
// different orders, must hash identically -- mirroring ledger's own
// map-order-independence property (Phase 1), which this defers to
// directly.
func TestBaseline_SnapshotHash_StableAndReproducible(t *testing.T) {
	build := func(order []string) *Baseline {
		b := NewBaseline(2)
		for _, v := range order {
			b.Observe("asn", v)
		}
		b.Observe("dst_host", "10.0.0.5")
		return b
	}

	a := build([]string{"AS1", "AS2", "AS3"})
	c := build([]string{"AS3", "AS1", "AS2"})

	idA, _, err := a.SnapshotHash()
	if err != nil {
		t.Fatal(err)
	}
	idC, _, err := c.SnapshotHash()
	if err != nil {
		t.Fatal(err)
	}
	if idA != idC {
		t.Fatalf("snapshot hash differs by observation order: %s vs %s", idA, idC)
	}

	// Reproducible: hashing the SAME baseline twice gives the same hash.
	idA2, _, err := a.SnapshotHash()
	if err != nil {
		t.Fatal(err)
	}
	if idA != idA2 {
		t.Fatalf("snapshot hash not reproducible across repeated calls: %s vs %s", idA, idA2)
	}
}

func TestBaseline_SnapshotHash_ChangesWithContent(t *testing.T) {
	b1 := NewBaseline(2)
	b1.Observe("asn", "AS1")
	id1, _, err := b1.SnapshotHash()
	if err != nil {
		t.Fatal(err)
	}

	b2 := NewBaseline(2)
	b2.Observe("asn", "AS1")
	b2.Observe("asn", "AS2")
	id2, _, err := b2.SnapshotHash()
	if err != nil {
		t.Fatal(err)
	}

	if id1 == id2 {
		t.Fatal("two baselines with different observed content produced the same snapshot hash")
	}
}

func TestStore_SnapshotHash_StableAcrossEntityInsertionOrder(t *testing.T) {
	build := func(order []string) *Store {
		s := NewStore(1)
		for _, entity := range order {
			s.Get(entity).Observe("asn", "AS1")
		}
		return s
	}

	a := build([]string{"jdoe", "asmith", "svc-ci"})
	b := build([]string{"svc-ci", "jdoe", "asmith"})

	idA, _, err := a.SnapshotHash()
	if err != nil {
		t.Fatal(err)
	}
	idB, _, err := b.SnapshotHash()
	if err != nil {
		t.Fatal(err)
	}
	if idA != idB {
		t.Fatalf("store snapshot hash differs by entity insertion order: %s vs %s", idA, idB)
	}
}

// TestStore_ReplayAgainstPinnedSnapshot_ReproducesIdenticalDecisions is
// the Phase 4 gate's second requirement: "replaying a corpus against a
// pinned snapshot reproduces identical statistical claims." A "pinned
// snapshot" here is simply a Store whose warm-up phase has already run —
// IsNovel decisions against it must be identical no matter how many
// times the same query is repeated, and independent of anything other
// than the snapshot's own content.
func TestStore_ReplayAgainstPinnedSnapshot_ReproducesIdenticalDecisions(t *testing.T) {
	pinned := NewStore(2)
	pinned.Get("jdoe").Observe("asn", "AS1")
	pinned.Get("jdoe").Observe("asn", "AS1")
	pinnedHash, _, err := pinned.SnapshotHash()
	if err != nil {
		t.Fatal(err)
	}

	for i := 0; i < 10; i++ {
		if pinned.Get("jdoe").IsNovel("asn", "AS2") != true {
			t.Fatalf("iteration %d: IsNovel(AS2) drifted from true", i)
		}
		if pinned.Get("jdoe").IsNovel("asn", "AS1") != false {
			t.Fatalf("iteration %d: IsNovel(AS1) drifted from false", i)
		}
	}

	// Querying must not itself mutate state -- the snapshot stays pinned.
	againHash, _, err := pinned.SnapshotHash()
	if err != nil {
		t.Fatal(err)
	}
	if pinnedHash != againHash {
		t.Fatal("querying IsNovel mutated the snapshot's hash — reads must be side-effect-free")
	}
}
