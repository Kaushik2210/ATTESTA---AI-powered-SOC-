package ledger

import "testing"

func TestStore_PutIsIdempotent(t *testing.T) {
	store := NewStore()
	event := map[string]any{"kind": "auth_failed", "n": int64(1)}

	id1, err := store.Put(event)
	if err != nil {
		t.Fatal(err)
	}
	id2, err := store.Put(event)
	if err != nil {
		t.Fatal(err)
	}
	if id1 != id2 {
		t.Fatal("writing the identical event twice produced two different IDs")
	}

	payload, err := store.Get(id1)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload) == 0 {
		t.Fatal("expected a non-empty canonical payload")
	}
}

func TestStore_GetUnknownIDFails(t *testing.T) {
	store := NewStore()
	var unknown EvidenceID
	if _, err := store.Get(unknown); err != errUnknownEvidenceID {
		t.Fatalf("expected errUnknownEvidenceID, got %v", err)
	}
}

func TestStore_RedactUnknownIDFails(t *testing.T) {
	store := NewStore()
	var unknown EvidenceID
	if err := store.Redact(unknown); err != errUnknownEvidenceID {
		t.Fatalf("expected errUnknownEvidenceID, got %v", err)
	}
}
