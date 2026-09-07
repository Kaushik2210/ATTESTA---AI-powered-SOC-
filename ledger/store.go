package ledger

import "sync"

// Store is an append-only, content-addressed evidence store. This is an
// in-memory reference implementation sufficient to prove the
// canonicalization/hashing/Merkle logic in this package — the real
// ClickHouse-backed store (docs/ARCHITECTURE.md §2.3: ClickHouse for the
// event lake, mirrored into PostgreSQL for graph traversal) is wired up
// once a later phase actually needs to query it. Nothing above this type
// depends on the storage backend, so swapping it out is additive.
type Store struct {
	mu   sync.RWMutex
	rows map[EvidenceID]*record
}

type record struct {
	payload  []byte // canonical CBOR bytes; nil if redacted
	redacted bool
}

func NewStore() *Store {
	return &Store{rows: make(map[EvidenceID]*record)}
}

// Put appends an event, canonicalizing and hashing it first. Writing the
// same event again (same EvidenceID) is a no-op — invariant I3 (append-
// only, content-addressed): there is no "update", only new content
// producing a new address.
func (s *Store) Put(event any) (EvidenceID, error) {
	id, canonical, err := NewEvidenceID(event)
	if err != nil {
		return EvidenceID{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.rows[id]; !exists {
		s.rows[id] = &record{payload: canonical}
	}
	return id, nil
}

// Get returns the canonical payload for an EvidenceID. ok is false and err
// is errRedacted if the node exists but its payload has been redacted —
// callers must be able to tell "we deleted this for GDPR/DPDP erasure"
// apart from "this ID never existed", and must never substitute a default
// value for either case (docs/ARCHITECTURE.md §2.3: "reports 'evidence
// unavailable' honestly rather than silently changing the answer").
func (s *Store) Get(id EvidenceID) (payload []byte, err error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rec, exists := s.rows[id]
	if !exists {
		return nil, errUnknownEvidenceID
	}
	if rec.redacted {
		return nil, errRedacted
	}
	return rec.payload, nil
}

// Redact deletes an evidence node's payload while preserving its ID —
// the hash, and therefore every Merkle inclusion proof through it, stays
// valid forever. This is the mechanism behind GDPR/DPDP-compliant erasure
// that doesn't break replay: replay honestly reports the node as
// unavailable instead of silently changing the answer.
func (s *Store) Redact(id EvidenceID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, exists := s.rows[id]
	if !exists {
		return errUnknownEvidenceID
	}
	rec.payload = nil
	rec.redacted = true
	return nil
}

// IsRedacted reports whether an ID exists but has had its payload redacted.
func (s *Store) IsRedacted(id EvidenceID) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rec, exists := s.rows[id]
	return exists && rec.redacted
}

// Len returns the number of distinct EvidenceIDs ever written. Used by
// callers (e.g. ingest's replay tests) that need to confirm re-ingesting
// unchanged input added no new nodes — a direct check of invariant I3's
// dedup property, not something Put's return value alone shows.
func (s *Store) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.rows)
}
