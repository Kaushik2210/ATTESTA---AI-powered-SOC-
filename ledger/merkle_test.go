package ledger

import "testing"

func idsN(n int) []EvidenceID {
	ids := make([]EvidenceID, n)
	for i := range ids {
		id, _, err := NewEvidenceID(map[string]any{"i": int64(i)})
		if err != nil {
			panic(err)
		}
		ids[i] = id
	}
	return ids
}

// TestMerkle_EveryLeafProvesInclusion is the Phase 1 gate's "inclusion
// proofs verify for every node" requirement, across both power-of-two and
// non-power-of-two leaf counts (the padding path only exercises for the
// latter).
func TestMerkle_EveryLeafProvesInclusion(t *testing.T) {
	for _, n := range []int{1, 2, 3, 4, 5, 7, 8, 16, 17, 100} {
		ids := idsN(n)
		tree, err := BuildMerkleTree(ids)
		if err != nil {
			t.Fatalf("n=%d: BuildMerkleTree error: %v", n, err)
		}
		root := tree.Root()
		for i, id := range ids {
			proof, err := tree.Prove(i)
			if err != nil {
				t.Fatalf("n=%d leaf=%d: Prove error: %v", n, i, err)
			}
			if !VerifyInclusion(id, proof, root) {
				t.Fatalf("n=%d leaf=%d: inclusion proof did not verify", n, i)
			}
		}
	}
}

func TestMerkle_TamperedProofFailsVerification(t *testing.T) {
	ids := idsN(5)
	tree, err := BuildMerkleTree(ids)
	if err != nil {
		t.Fatal(err)
	}
	root := tree.Root()
	proof, err := tree.Prove(2)
	if err != nil {
		t.Fatal(err)
	}

	tampered := proof
	tampered.Steps = append([]ProofStep(nil), proof.Steps...)
	tampered.Steps[0].Hash[0] ^= 0xff
	if VerifyInclusion(ids[2], tampered, root) {
		t.Fatal("tampered proof unexpectedly verified")
	}
}

func TestMerkle_TamperedRootFailsVerification(t *testing.T) {
	ids := idsN(5)
	tree, err := BuildMerkleTree(ids)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := tree.Prove(0)
	if err != nil {
		t.Fatal(err)
	}
	root := tree.Root()
	root[0] ^= 0xff
	if VerifyInclusion(ids[0], proof, root) {
		t.Fatal("proof verified against a tampered root")
	}
}

func TestMerkle_WrongLeafFailsVerification(t *testing.T) {
	ids := idsN(5)
	tree, err := BuildMerkleTree(ids)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := tree.Prove(0)
	if err != nil {
		t.Fatal(err)
	}
	if VerifyInclusion(ids[1], proof, tree.Root()) {
		t.Fatal("leaf 0's proof unexpectedly verified for leaf 1's ID")
	}
}

func TestMerkle_EmptyTreeRejected(t *testing.T) {
	if _, err := BuildMerkleTree(nil); err == nil {
		t.Fatal("expected an error building a tree over zero leaves")
	}
}

func TestMerkle_DifferentTreeShapesProduceDifferentRoots(t *testing.T) {
	// Guards against the classic "duplicate the last node" vulnerability
	// class: two structurally different leaf sets must not collide on a
	// root just because one pads/duplicates into the other's shape.
	a, err := BuildMerkleTree(idsN(3))
	if err != nil {
		t.Fatal(err)
	}
	b, err := BuildMerkleTree(idsN(4))
	if err != nil {
		t.Fatal(err)
	}
	if a.Root() == b.Root() {
		t.Fatal("a 3-leaf tree and a 4-leaf tree produced the same root")
	}
}

// TestMerkle_RedactionIsStructurallyTolerant is the Phase 1 gate's "a
// redacted node still verifies structurally and reports unavailability"
// requirement (docs/ARCHITECTURE.md §2.3).
func TestMerkle_RedactionIsStructurallyTolerant(t *testing.T) {
	store := NewStore()
	events := []map[string]any{
		{"kind": "auth_failed", "n": int64(1)},
		{"kind": "auth_failed", "n": int64(2)},
		{"kind": "auth_succeeded", "n": int64(3)},
	}
	ids := make([]EvidenceID, len(events))
	for i, ev := range events {
		id, err := store.Put(ev)
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = id
	}

	tree, err := BuildMerkleTree(ids)
	if err != nil {
		t.Fatal(err)
	}
	root := tree.Root()
	proof, err := tree.Prove(1)
	if err != nil {
		t.Fatal(err)
	}

	// Before redaction: payload available, proof verifies.
	if _, err := store.Get(ids[1]); err != nil {
		t.Fatalf("expected payload available before redaction, got: %v", err)
	}
	if !VerifyInclusion(ids[1], proof, root) {
		t.Fatal("proof did not verify before redaction")
	}

	// Redact.
	if err := store.Redact(ids[1]); err != nil {
		t.Fatal(err)
	}

	// After redaction: payload reports unavailable (not silently
	// swapped for something else, not confused with "never existed").
	if _, err := store.Get(ids[1]); err != errRedacted {
		t.Fatalf("expected errRedacted after redaction, got: %v", err)
	}
	if !store.IsRedacted(ids[1]) {
		t.Fatal("IsRedacted false after redaction")
	}

	// The Merkle proof for the SAME ID still verifies against the SAME
	// root — redaction never touches the hash structure, only the store.
	if !VerifyInclusion(ids[1], proof, root) {
		t.Fatal("inclusion proof stopped verifying after redaction — it must not: proofs depend only on the hash, never the payload")
	}

	// A never-written ID is a distinct failure mode from "redacted" —
	// replay must be able to tell "we don't have this" apart from
	// "we deleted this on purpose".
	unknown, _, err := NewEvidenceID(map[string]any{"kind": "never_written"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(unknown); err != errUnknownEvidenceID {
		t.Fatalf("expected errUnknownEvidenceID for a never-written id, got: %v", err)
	}
}
