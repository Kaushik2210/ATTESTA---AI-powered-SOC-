package detect

import (
	"fmt"
	"sort"

	"github.com/Kaushik2210/attesta/detect/expr"
	"github.com/Kaushik2210/attesta/detect/stats"
)

// Claim is what a rule emits — never an alert. Severity is decided later
// by the Adjudication Kernel from the full claim set (docs/ARCHITECTURE.md
// §2.5, §2.7), never by whichever rule happened to fire; this reference
// engine only produces the predicate/entity/observed-value triple a real
// Claim's extractor-facing fields would wrap.
type Claim struct {
	Predicate     string
	EntityValue   string
	ObservedValue any // int64, float64, string, bool, or nil
	RuleID        string
	RuleVersion   int
}

// EvaluateStreaming is CDL's direct (non-SQL) execution path: the one a
// real-time streaming operator runs. It groups events per source by that
// source's group_by fields, correlates sources sharing a case (the union
// of every source's group_by fields — docs/ARCHITECTURE.md §2.5), and
// evaluates each `emits` clause's `when`/`observed` against the resulting
// per-case aggregates, after excluding any case a `suppress` clause
// matches.
//
// Windowing note (see phases/reports/PHASE-03.md): `window` is currently
// informational. This reference engine computes one aggregate per case
// over the entire fixture rather than implementing sliding/tumbling
// window bucketing — real continuous-stream windowing (state expiry,
// watermarks, late data) is a separate, substantial feature deferred
// rather than half-built here. Fixtures are written so every case's
// events fall within the rule's stated window by construction.
//
// store is the (possibly already warmed-up) baseline snapshot
// baseline_is_novel reads from — pass stats.NewStore(0) for a rule that
// doesn't use it. Query-only: EvaluateStreaming never writes to store
// (see detect/runner.go's WarmUpBaseline for how a store gets warmed up
// before replay, per docs/PHASES.md's "replaying a corpus against a
// pinned snapshot" gate requirement).
func EvaluateStreaming(rule *Rule, events []map[string]any, store *stats.Store) ([]Claim, error) {
	funcs := mergeFuncs(builtinFuncs(), baselineFuncs(store))
	unionFields := unionGroupFields(rule.Sources)
	cases := enumerateCases(events, unionFields)

	sourceNames := make([]string, 0, len(rule.Sources))
	for name := range rule.Sources {
		sourceNames = append(sourceNames, name)
	}
	sort.Strings(sourceNames)

	var claims []Claim
	for _, c := range cases {
		aggs := make(aggregateEnv, len(sourceNames))
		for _, name := range sourceNames {
			agg, err := computeAggregate(events, rule.Sources[name], c.values, funcs)
			if err != nil {
				return nil, fmt.Errorf("detect: rule %s, source %q: %w", rule.ID, name, err)
			}
			aggs[name] = agg
		}

		suppressed, err := isSuppressed(rule, aggs, funcs)
		if err != nil {
			return nil, fmt.Errorf("detect: rule %s: %w", rule.ID, err)
		}
		if suppressed {
			continue
		}

		entityValue, _ := c.values[rule.Entity]
		entityStr := renderScalar(entityValue)

		for _, emit := range rule.Emits {
			whenNode, err := expr.Parse(emit.When)
			if err != nil {
				return nil, fmt.Errorf("detect: rule %s, emit %q: parsing when: %w", rule.ID, emit.Predicate, err)
			}
			matched, err := expr.EvalBool(whenNode, &expr.Context{Env: aggs, Funcs: funcs})
			if err != nil {
				return nil, fmt.Errorf("detect: rule %s, emit %q: evaluating when: %w", rule.ID, emit.Predicate, err)
			}
			if !matched {
				continue
			}
			var observed any
			if emit.Observed != "" {
				obsNode, err := expr.Parse(emit.Observed)
				if err != nil {
					return nil, fmt.Errorf("detect: rule %s, emit %q: parsing observed: %w", rule.ID, emit.Predicate, err)
				}
				observed, err = expr.Eval(obsNode, &expr.Context{Env: aggs, Funcs: funcs})
				if err != nil {
					return nil, fmt.Errorf("detect: rule %s, emit %q: evaluating observed: %w", rule.ID, emit.Predicate, err)
				}
			}
			claims = append(claims, Claim{
				Predicate:     emit.Predicate,
				EntityValue:   entityStr,
				ObservedValue: observed,
				RuleID:        rule.ID,
				RuleVersion:   rule.Version,
			})
		}
	}
	return claims, nil
}

// isSuppressed evaluates every suppress clause against this case's
// aggregates, using the exact same "<source>.<field>" resolution
// when/observed use (env.go's aggregateEnv) — suppress is not a
// specially-shaped clause with its own access mechanism, just another
// aggregate-scoped condition.
func isSuppressed(rule *Rule, aggs aggregateEnv, funcs map[string]expr.Func) (bool, error) {
	if len(rule.Suppress) == 0 {
		return false, nil
	}
	for _, s := range rule.Suppress {
		node, err := expr.Parse(s.When)
		if err != nil {
			return false, fmt.Errorf("suppress clause %q: %w", s.When, err)
		}
		matched, err := expr.EvalBool(node, &expr.Context{Env: aggs, Funcs: funcs})
		if err != nil {
			return false, fmt.Errorf("suppress clause %q: %w", s.When, err)
		}
		if matched {
			return true, nil
		}
	}
	return false, nil
}
