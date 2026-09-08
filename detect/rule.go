// Package detect implements CDL (Correlation Definition Language) —
// docs/DETECTION-SPEC.md: one declarative rule definition, compiled to two
// independently-executed targets (a direct Go streaming evaluator and a
// SQL query, run here against an embedded SQLite as a stand-in for
// ClickHouse — see sql.go's doc comment), so "what would this rule have
// caught last quarter?" is answered by the SAME rule text that runs in
// real time, not a second implementation that can silently drift from it.
//
// A rule emits Claims, not alerts — severity is decided later by the
// Adjudication Kernel (Phase 5) from the full claim set, never by
// whichever rule happened to fire.
package detect

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// EmitSpec is one predicate a rule can produce.
type EmitSpec struct {
	Predicate string `yaml:"predicate"`
	When      string `yaml:"when"`
	Observed  string `yaml:"observed,omitempty"`
}

// SourceSpec defines one named, filtered, grouped view over the event
// stream that a rule's `emits`/`suppress` expressions reference by name.
type SourceSpec struct {
	// From documents which normalized source this reads (e.g.
	// "ocsf.authentication") — informational in this reference engine,
	// which evaluates against whatever events it's given rather than
	// routing by declared source.
	From string `yaml:"from"`
	// Where is a boolean CDL expression evaluated per-event.
	Where string `yaml:"where"`
	// GroupBy lists the dotted field paths that key this source's
	// aggregation.
	GroupBy []string `yaml:"group_by"`
	// TrackDistinct lists dotted field paths to count distinct values of
	// within each group, exposed as "<source>.distinct_<alias>".
	TrackDistinct []string `yaml:"track_distinct,omitempty"`
	// TrackLast lists dotted field paths to capture the value of, from
	// whichever matching event has the latest timestamp in each group,
	// exposed as "<source>.last_<alias>".
	TrackLast []string `yaml:"track_last,omitempty"`
}

// SuppressSpec is a false-positive exclusion. Every suppress clause must
// carry a reason (docs/DETECTION-SPEC.md: "Undocumented suppression is
// how SOCs go blind") — enforced in Validate.
type SuppressSpec struct {
	When   string `yaml:"when"`
	Reason string `yaml:"reason"`
}

// TestSpec is one fixture this rule ships with. Baseline, when set, names
// a second fixture replayed first to warm up a fresh stats.Store before
// Fixture is evaluated against it — see detect/runner.go's
// WarmUpBaseline. Empty means the rule doesn't need baseline state for
// this test (an empty, unwarmed store is still passed through, so
// baseline_is_novel calls stay well-defined — see docs/DETECTION-SPEC.md's
// "Statistical layer" and phases/reports/PHASE-04.md).
type TestSpec struct {
	Fixture  string   `yaml:"fixture"`
	Baseline string   `yaml:"baseline,omitempty"`
	Expect   []string `yaml:"expect"`
}

// BaselineObservation is one attribute this rule's baseline tracks —
// e.g. "record every ASN this principal has authenticated from".
type BaselineObservation struct {
	Attribute string `yaml:"attribute"`
	From      string `yaml:"from"` // dotted field path in the raw event
}

// BaselineSpec declares what this rule's first-time-seen baseline
// tracks. The entity a baseline is keyed by is always the rule's own
// Entity field — one baseline concept per rule, not a second one to keep
// in sync.
type BaselineSpec struct {
	WarmupThreshold int64                 `yaml:"warmup_threshold"`
	Observations    []BaselineObservation `yaml:"observations"`
}

// Rule is one compiled CDL rule definition.
type Rule struct {
	ID         string                `yaml:"id"`
	Version    int                   `yaml:"version"`
	Title      string                `yaml:"title"`
	Severity   string                `yaml:"severity"`
	Tactics    []string              `yaml:"tactics"`
	Techniques []string              `yaml:"techniques"`
	Entity     string                `yaml:"entity"`
	Window     string                `yaml:"window"`
	Baseline   *BaselineSpec         `yaml:"baseline,omitempty"`
	Emits      []EmitSpec            `yaml:"emits"`
	Sources    map[string]SourceSpec `yaml:"sources"`
	Suppress   []SuppressSpec        `yaml:"suppress,omitempty"`
	Tests      []TestSpec            `yaml:"tests"`

	// dir is the directory the rule file lives in, used to resolve
	// fixture paths (which are relative to the rule, per
	// docs/DETECTION-SPEC.md's worked example).
	dir string
}

// LoadRule reads, parses, and validates one CDL rule file.
func LoadRule(path string) (*Rule, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("detect: reading rule %s: %w", path, err)
	}
	var r Rule
	if err := yaml.Unmarshal(data, &r); err != nil {
		return nil, fmt.Errorf("detect: parsing rule %s: %w", path, err)
	}
	r.dir = dirOf(path)
	if err := r.Validate(); err != nil {
		return nil, fmt.Errorf("detect: rule %s: %w", path, err)
	}
	return &r, nil
}

func dirOf(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' || path[i] == '\\' {
			return path[:i]
		}
	}
	return "."
}

// Validate enforces the structural requirements the Phase 3 exit gate
// tests directly: a rule lacking a negative fixture (a test whose Expect
// is empty) is rejected outright — "a rule without a negative fixture is
// a future false-positive storm" (docs/DETECTION-SPEC.md). Every
// suppress clause must carry a non-empty reason for the same
// "undocumented suppression is how SOCs go blind" reasoning.
func (r *Rule) Validate() error {
	if r.ID == "" {
		return fmt.Errorf("missing id")
	}
	if r.Version <= 0 {
		return fmt.Errorf("version must be positive")
	}
	if r.Entity == "" {
		return fmt.Errorf("missing entity")
	}
	if len(r.Emits) == 0 {
		return fmt.Errorf("rule defines no emits")
	}
	if len(r.Sources) == 0 {
		return fmt.Errorf("rule defines no sources")
	}
	entityDeclared := false
	for _, src := range r.Sources {
		for _, f := range src.GroupBy {
			if f == r.Entity {
				entityDeclared = true
			}
		}
	}
	if !entityDeclared {
		return fmt.Errorf("entity %q is not a group_by field of any source — it would never resolve to an actual value", r.Entity)
	}
	for _, s := range r.Suppress {
		if s.Reason == "" {
			return fmt.Errorf("suppress clause %q has no reason", s.When)
		}
	}
	if r.Baseline != nil {
		if r.Baseline.WarmupThreshold <= 0 {
			return fmt.Errorf("baseline.warmup_threshold must be positive")
		}
		if len(r.Baseline.Observations) == 0 {
			return fmt.Errorf("baseline declared but has no observations")
		}
		for _, o := range r.Baseline.Observations {
			if o.Attribute == "" || o.From == "" {
				return fmt.Errorf("baseline observation missing attribute or from")
			}
		}
	}
	if len(r.Tests) == 0 {
		return fmt.Errorf("rule ships no test fixtures at all")
	}
	hasNegative := false
	for _, t := range r.Tests {
		if len(t.Expect) == 0 {
			hasNegative = true
		}
	}
	if !hasNegative {
		return fmt.Errorf("rule has no negative fixture (a test with an empty expect list) — a rule without one is a future false-positive storm")
	}
	return nil
}

// FixturePath resolves a test's fixture path relative to the rule file's
// own directory.
func (r *Rule) FixturePath(t TestSpec) string {
	return r.dir + "/" + t.Fixture
}
