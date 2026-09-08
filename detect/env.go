package detect

import (
	"fmt"
	"strings"

	"github.com/Kaushik2210/attesta/detect/expr"
	"github.com/Kaushik2210/attesta/detect/stats"
)

// eventEnv resolves a `where` clause's dotted paths directly against one
// raw normalized event. A missing field resolves to nil rather than an
// error — that's a normal, expected case for a filter clause (this event
// just doesn't carry that field, so it won't match), not a rule bug. nil
// participates correctly in == / != via Go's ordinary interface equality;
// see this package's doc comment on eval semantics in streaming.go.
type eventEnv map[string]any

func (e eventEnv) Resolve(path []string) (any, error) {
	v, _ := resolvePath(map[string]any(e), path)
	return v, nil
}

// aggregateEnv resolves a `when`/`observed`/`suppress.when` clause's
// dotted paths as <source>.<field> against that case's computed
// Aggregates. Unlike eventEnv, an unknown source or unsupported field
// name IS an error: these clauses reference a rule's own declared
// sources, so a typo here is a rule-authoring bug worth surfacing loudly,
// not a per-event data-completeness question.
type aggregateEnv map[string]*Aggregate

func (e aggregateEnv) Resolve(path []string) (any, error) {
	if len(path) < 2 {
		return nil, fmt.Errorf("detect: expected <source>.<field>, got %v", path)
	}
	agg, ok := e[path[0]]
	if !ok {
		return nil, fmt.Errorf("detect: unknown source %q", path[0])
	}
	field := path[1]
	switch {
	case field == "count":
		return agg.Count, nil
	case field == "exists":
		return agg.Count > 0, nil
	case field == "first_ts":
		return agg.FirstTS, nil
	case field == "last_ts":
		return agg.LastTS, nil
	case strings.HasPrefix(field, "distinct_"):
		alias := strings.TrimPrefix(field, "distinct_")
		return agg.Distinct[alias], nil
	case strings.HasPrefix(field, "last_"):
		// A missing entry here is NOT necessarily a rule-authoring bug:
		// it also means this case's matching events never actually
		// carried the tracked field (e.g. a case with only one event at
		// all, or events that simply lack optional enrichment data).
		// That's a normal, expected condition — resolving to nil (like
		// eventEnv does for an absent raw field) lets a rule guard with
		// `x != null and ...` instead of every such case hard-erroring
		// the whole evaluation. See phases/reports/PHASE-04.md: this
		// was a real bug, caught by the benign-corpus FP measurement
		// hitting exactly this case for the first time.
		alias := strings.TrimPrefix(field, "last_")
		return agg.Last[alias], nil
	default:
		// Fall back to this source's own group_by field values, so e.g.
		// "failures.src_endpoint_ip" reads back the same value that
		// defined the group — no separate access mechanism needed for
		// suppress clauses beyond what when/observed already use.
		if v, ok := agg.GroupValues[field]; ok {
			return v, nil
		}
		return nil, fmt.Errorf("detect: unknown aggregate field %q for source %q (not count/exists/first_ts/last_ts/distinct_*/last_*, and not a group_by field)", field, path[0])
	}
}

// builtinFuncs is the CDL function registry available to Eval. This
// reference engine hardcodes a small, static asset-group table rather
// than reading from policy/ (docs/ARCHITECTURE.md's real home for asset
// groups) — real asset-group management is a later phase's concern; this
// is enough to prove the suppress mechanism works end to end.
var assetGroups = map[string][]any{
	"ci-runners":       {"198.51.100.9"},
	"corporate-egress": {"203.0.113.44"},
}

func builtinFuncs() map[string]expr.Func {
	return map[string]expr.Func{
		"asset_group": func(args []any) (any, error) {
			if len(args) != 1 {
				return nil, fmt.Errorf("asset_group takes exactly 1 argument")
			}
			name, ok := args[0].(string)
			if !ok {
				return nil, fmt.Errorf("asset_group argument must be a string")
			}
			return assetGroups[name], nil
		},
	}
}

// builtinFuncsSQL is the SQL rendering of the same registry — see
// sql.go. Rendered as a literal SQL tuple, e.g. asset_group('ci-runners')
// -> ('198.51.100.9'), so `x in asset_group(...)` becomes ordinary SQL
// `x IN (...)`.
func builtinFuncsSQL() map[string]expr.FuncSQL {
	return map[string]expr.FuncSQL{
		"asset_group": func(args []string) (string, error) {
			if len(args) != 1 {
				return "", fmt.Errorf("asset_group takes exactly 1 argument")
			}
			name := strings.Trim(args[0], "'")
			items := assetGroups[name]
			parts := make([]string, len(items))
			for i, v := range items {
				s, ok := v.(string)
				if !ok {
					return "", fmt.Errorf("asset_group %q contains a non-string entry", name)
				}
				parts[i] = "'" + strings.ReplaceAll(s, "'", "''") + "'"
			}
			return "(" + strings.Join(parts, ", ") + ")", nil
		},
	}
}

// baselineFuncs returns the CDL functions backed by a live stats.Store —
// docs/DETECTION-SPEC.md's "Statistical layer". Unlike asset_group,
// these read external mutable state, so they're built fresh per
// evaluation run (see streaming.go/sql.go), closed over the specific
// Store that run's caller passed in (a warmed-up "pinned snapshot" for
// replay determinism — phases/reports/PHASE-04.md).
func baselineFuncs(store *stats.Store) map[string]expr.Func {
	return map[string]expr.Func{
		"baseline_is_novel": func(args []any) (any, error) {
			if len(args) != 3 {
				return nil, fmt.Errorf("baseline_is_novel takes exactly 3 arguments (entity, attribute, value)")
			}
			entity, ok := args[0].(string)
			if !ok {
				return nil, fmt.Errorf("baseline_is_novel: entity must be a string, got %T", args[0])
			}
			attribute, ok := args[1].(string)
			if !ok {
				return nil, fmt.Errorf("baseline_is_novel: attribute must be a string, got %T", args[1])
			}
			return store.Get(entity).IsNovel(attribute, renderScalar(args[2])), nil
		},
	}
}

// baselineFuncsSQL renders baseline_is_novel against two tables RunSQL
// populates from the same Store's current content immediately before
// running a rule's queries (sql.go's createBaselineTables/
// insertBaselineData) — "baseline_seen" (entity, attribute, value) and
// "baseline_observation_count" (entity, attribute, count). Rendering a
// live Go map as SQL lookup tables, rather than trying to express
// first-time-seen set membership as a SQL expression, is what lets the
// SQL path check the exact same snapshot the streaming path does.
func baselineFuncsSQL(store *stats.Store) map[string]expr.FuncSQL {
	warmup := store.WarmupThreshold
	return map[string]expr.FuncSQL{
		"baseline_is_novel": func(args []string) (string, error) {
			if len(args) != 3 {
				return "", fmt.Errorf("baseline_is_novel takes exactly 3 arguments (entity, attribute, value)")
			}
			e, a, v := args[0], args[1], args[2]
			return fmt.Sprintf(
				"((SELECT COALESCE(cnt, 0) FROM baseline_observation_count WHERE entity = %s AND attribute = %s) >= %d "+
					"AND NOT EXISTS (SELECT 1 FROM baseline_seen WHERE entity = %s AND attribute = %s AND value = %s))",
				e, a, warmup, e, a, v,
			), nil
		},
	}
}

// mergeFuncs combines multiple CDL function registries into one, later
// maps overriding earlier ones on key collision (none of this reference
// engine's registries collide in practice).
func mergeFuncs[T any](maps ...map[string]T) map[string]T {
	out := make(map[string]T)
	for _, m := range maps {
		for k, v := range m {
			out[k] = v
		}
	}
	return out
}
