package detect

import (
	"fmt"
	"strings"

	"github.com/Kaushik2210/attesta/detect/expr"
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
		alias := strings.TrimPrefix(field, "last_")
		v, ok := agg.Last[alias]
		if !ok {
			return nil, fmt.Errorf("detect: no tracked last-value %q for source %q (add it to track_last)", alias, path[0])
		}
		return v, nil
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
