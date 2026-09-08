package detect

import (
	"path/filepath"
	"testing"

	"github.com/Kaushik2210/attesta/detect/stats"
)

// TestShippedRules_FixturesPass is the Phase 3 gate's first requirement:
// "every shipped rule passes its positive and negative fixtures"
// (phases/PHASES.md).
func TestShippedRules_FixturesPass(t *testing.T) {
	for _, name := range shippedRuleFiles {
		name := name
		t.Run(name, func(t *testing.T) {
			rule, err := LoadRule(filepath.Join(rulesDir(t), name))
			if err != nil {
				t.Fatal(err)
			}
			if err := RunFixtureTests(rule); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// TestShippedRules_StreamingAndSQLAgree is the Phase 3 gate's second
// requirement: "for each rule, the streaming path and the SQL path
// produce the identical claim set over the same fixture corpus."
func TestShippedRules_StreamingAndSQLAgree(t *testing.T) {
	for _, name := range shippedRuleFiles {
		name := name
		t.Run(name, func(t *testing.T) {
			rule, err := LoadRule(filepath.Join(rulesDir(t), name))
			if err != nil {
				t.Fatal(err)
			}
			if err := RunEquivalence(rule); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// TestShippedRules_SQLCompiles is a narrower, faster sanity check run
// independently of fixture execution: every shipped rule's SQL must at
// least compile to valid query text (parseable expressions, resolvable
// columns) even before it's run against data.
func TestShippedRules_SQLCompiles(t *testing.T) {
	for _, name := range shippedRuleFiles {
		name := name
		t.Run(name, func(t *testing.T) {
			rule, err := LoadRule(filepath.Join(rulesDir(t), name))
			if err != nil {
				t.Fatal(err)
			}
			queries, err := CompileRuleSQL(rule, stats.NewStore(0))
			if err != nil {
				t.Fatal(err)
			}
			if len(queries) != len(rule.Emits) {
				t.Fatalf("got %d compiled queries, want %d (one per emit)", len(queries), len(rule.Emits))
			}
			for predicate, q := range queries {
				if q == "" {
					t.Fatalf("empty compiled query for predicate %q", predicate)
				}
			}
		})
	}
}
