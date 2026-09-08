// Package stats implements CDL's per-entity statistical baseline layer —
// docs/DETECTION-SPEC.md's "Statistical layer": "First-time-seen tracking
// per (entity, attribute) pair with a configurable warm-up so a fresh
// deployment does not alert on everything for a week."
//
// Scope note (see phases/reports/PHASE-04.md): this tracks seen values
// exactly, via a hash set, rather than a space-bounded probabilistic
// sketch (Count-Min/HyperLogLog) as docs/ARCHITECTURE.md's ideal
// describes. Exact tracking is strictly MORE accurate, and is what
// actually lets this phase prove the property its gate cares about —
// deterministic, snapshot-hashable baseline state — without also having
// to get a probabilistic sketch's approximation error right by hand,
// unverified, in one pass. Swapping in a real sketch for memory
// efficiency at scale is a later, purely internal optimization that
// wouldn't change this package's public behavior. Robust z-score (MAD)
// and t-digest volume percentiles are deferred entirely: none of Phase
// 3/4's shipped rules need them yet — building them unused and untested
// against a real rule would be exactly the kind of speculative,
// unverifiable work CLAUDE.md's engineering standards warn against.
package stats

import (
	"sort"

	"github.com/Kaushik2210/attesta/ledger"
)

// Baseline is one entity's first-time-seen tracker: for each attribute
// name (e.g. "asn", "dst_host"), the set of values ever observed for
// this entity, and how many observations have been recorded — the
// warm-up gate.
type Baseline struct {
	WarmupThreshold  int64
	ObservationCount map[string]int64
	SeenValues       map[string]map[string]bool
}

func NewBaseline(warmupThreshold int64) *Baseline {
	return &Baseline{
		WarmupThreshold:  warmupThreshold,
		ObservationCount: map[string]int64{},
		SeenValues:       map[string]map[string]bool{},
	}
}

// Observe records one attribute value during baseline warm-up (or
// ongoing operation — nothing distinguishes the two once running).
func (b *Baseline) Observe(attribute, value string) {
	b.ObservationCount[attribute]++
	if b.SeenValues[attribute] == nil {
		b.SeenValues[attribute] = map[string]bool{}
	}
	b.SeenValues[attribute][value] = true
}

// IsNovel reports whether value has never been observed for attribute
// AND enough observations have accumulated to trust that absence. Below
// WarmupThreshold, IsNovel always returns false ("not yet decided" reads
// as "not novel") — exactly the "a fresh deployment does not alert on
// everything for a week" property, using an observation count as a
// deliberately simple, testable proxy for a real time-based warm-up
// window (see this file's package doc comment).
func (b *Baseline) IsNovel(attribute, value string) bool {
	if b.ObservationCount[attribute] < b.WarmupThreshold {
		return false
	}
	return !b.SeenValues[attribute][value]
}

// Snapshot returns a canonical, ledger-hashable representation: sorted
// attribute names and sorted seen-value lists, so two Baselines with the
// same logical content always produce the same canonical bytes
// regardless of Go's randomized map iteration order — this is what makes
// SnapshotHash stable and reproducible (the Phase 4 gate's requirement),
// and it does so by deferring to ledger.EncodeCanonical's own
// determinism guarantee (Phase 1) rather than re-implementing
// canonicalization a second time.
func (b *Baseline) Snapshot() map[string]any {
	attrs := make([]string, 0, len(b.SeenValues))
	for a := range b.SeenValues {
		attrs = append(attrs, a)
	}
	sort.Strings(attrs)

	seen := make(map[string]any, len(attrs))
	counts := make(map[string]any, len(attrs))
	for _, a := range attrs {
		values := make([]string, 0, len(b.SeenValues[a]))
		for v := range b.SeenValues[a] {
			values = append(values, v)
		}
		sort.Strings(values)
		asAny := make([]any, len(values))
		for i, v := range values {
			asAny[i] = v
		}
		seen[a] = asAny
		counts[a] = b.ObservationCount[a]
	}

	return map[string]any{
		"warmup_threshold":  b.WarmupThreshold,
		"observation_count": counts,
		"seen_values":       seen,
	}
}

// SnapshotHash canonicalizes and hashes this baseline's current state,
// via the same ledger.NewEvidenceID Phase 1's evidence pipeline uses —
// a baseline snapshot is, structurally, just another content-addressed
// node.
func (b *Baseline) SnapshotHash() (ledger.EvidenceID, []byte, error) {
	return ledger.NewEvidenceID(b.Snapshot())
}
