package stats

import (
	"sort"

	"github.com/Kaushik2210/attesta/ledger"
)

// Store holds one Baseline per entity value (e.g. per principal). This is
// what CDL's baseline_is_novel function (detect/env.go) reads and what a
// rule's warm-up fixture writes to (detect/runner.go's WarmUpBaseline).
type Store struct {
	WarmupThreshold int64
	Baselines       map[string]*Baseline
}

func NewStore(warmupThreshold int64) *Store {
	return &Store{WarmupThreshold: warmupThreshold, Baselines: map[string]*Baseline{}}
}

// Get returns the Baseline for entityKey, creating an empty one (with
// this Store's WarmupThreshold) the first time it's requested.
func (s *Store) Get(entityKey string) *Baseline {
	b, ok := s.Baselines[entityKey]
	if !ok {
		b = NewBaseline(s.WarmupThreshold)
		s.Baselines[entityKey] = b
	}
	return b
}

// Snapshot returns a canonical, ledger-hashable representation of every
// entity's baseline, sorted by entity key for the same determinism
// reason Baseline.Snapshot sorts attribute names.
func (s *Store) Snapshot() map[string]any {
	keys := make([]string, 0, len(s.Baselines))
	for k := range s.Baselines {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	out := make(map[string]any, len(keys))
	for _, k := range keys {
		out[k] = s.Baselines[k].Snapshot()
	}
	return out
}

func (s *Store) SnapshotHash() (ledger.EvidenceID, []byte, error) {
	return ledger.NewEvidenceID(s.Snapshot())
}
