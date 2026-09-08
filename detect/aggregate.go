package detect

import (
	"sort"
	"strings"

	"github.com/Kaushik2210/attesta/detect/expr"
)

// Aggregate is what one named source computes for one correlation case
// (docs/DETECTION-SPEC.md's `sources`): how many matching events, over
// what time span, how many distinct values of any track_distinct field,
// and the value of any track_last field from whichever matching event
// has the latest timestamp.
type Aggregate struct {
	Count    int64
	FirstTS  int64
	LastTS   int64
	Distinct map[string]int64 // field alias -> distinct value count
	Last     map[string]any   // field alias -> value from the latest-ts matching event

	// GroupValues holds this case's own group_by field values (field
	// alias -> value) so a suppress clause (or anything else) can read
	// them back the same way it reads count/last_X — e.g.
	// "failures.src_endpoint_ip" — rather than needing a second,
	// differently-shaped access mechanism. Populated even when Count is
	// 0, as long as the case actually projects onto this source's
	// group_by fields at all.
	GroupValues map[string]any
}

// fieldAlias turns a dotted field path into the flat name it's exposed
// under on an Aggregate, e.g. "src_endpoint.ip" -> "src_endpoint_ip", so
// `sessions.distinct_src_endpoint_ip` resolves correctly.
func fieldAlias(dotted string) string {
	return strings.ReplaceAll(dotted, ".", "_")
}

// unionGroupFields returns the deduplicated union of every source's
// group_by fields, in a deterministic order (sorted by source name, then
// declaration order within each source) — this is the set of fields that
// define a correlation "case": docs/ARCHITECTURE.md §2.5's example
// correlates failures (grouped by user+ip) with success (grouped by user
// alone) by projecting the finer key down to the coarser one.
func unionGroupFields(sources map[string]SourceSpec) []string {
	names := make([]string, 0, len(sources))
	for name := range sources {
		names = append(names, name)
	}
	sort.Strings(names)

	seen := map[string]bool{}
	var out []string
	for _, name := range names {
		for _, f := range sources[name].GroupBy {
			if !seen[f] {
				seen[f] = true
				out = append(out, f)
			}
		}
	}
	return out
}

// caseInfo is one distinct combination of union-group-field values
// observed anywhere in the event set.
type caseInfo struct {
	key    string
	values map[string]any // dotted field path -> value
}

// enumerateCases finds every distinct case, in first-seen order (which,
// for a fixture file processed in line order, is deterministic).
func enumerateCases(events []map[string]any, unionFields []string) []caseInfo {
	seen := map[string]bool{}
	var out []caseInfo
	for _, ev := range events {
		values := make(map[string]any, len(unionFields))
		complete := true
		for _, f := range unionFields {
			v, ok := resolvePath(ev, splitPath(f))
			if !ok {
				complete = false
				break
			}
			values[f] = v
		}
		if !complete {
			continue // this event doesn't carry every field a case needs; it can't anchor one
		}
		key, _ := groupKeyFromGetter(func(path []string) (any, bool) {
			v, ok := values[strings.Join(path, ".")]
			return v, ok
		}, unionFields)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, caseInfo{key: key, values: values})
	}
	return out
}

// computeAggregate evaluates one source's Where clause against every
// event, restricted to the sub-key this case projects onto that source's
// own group_by fields, and accumulates count/first_ts/last_ts/distinct/
// last-tracked-value/sample-event over the matches.
func computeAggregate(events []map[string]any, src SourceSpec, caseValues map[string]any, funcs map[string]expr.Func) (*Aggregate, error) {
	whereNode, err := expr.Parse(src.Where)
	if err != nil {
		return nil, err
	}

	subKeyWant, ok := groupKeyFromGetter(func(path []string) (any, bool) {
		v, ok := caseValues[strings.Join(path, ".")]
		return v, ok
	}, src.GroupBy)
	if !ok {
		// This case doesn't carry the fields this source groups by at
		// all -- an empty aggregate (exists=false) is the correct
		// answer, not an error.
		return &Aggregate{Distinct: map[string]int64{}, Last: map[string]any{}}, nil
	}

	groupValues := make(map[string]any, len(src.GroupBy))
	for _, f := range src.GroupBy {
		groupValues[fieldAlias(f)] = caseValues[f]
	}

	agg := &Aggregate{Distinct: map[string]int64{}, Last: map[string]any{}, GroupValues: groupValues}
	distinctSets := make(map[string]map[string]struct{}, len(src.TrackDistinct))
	bestLastTS := int64(0)

	for _, ev := range events {
		matched, err := expr.EvalBool(whereNode, &expr.Context{Env: eventEnv(ev), Funcs: funcs})
		if err != nil {
			return nil, err
		}
		if !matched {
			continue
		}
		subKey, ok := groupKey(ev, src.GroupBy)
		if !ok || subKey != subKeyWant {
			continue
		}

		tsAny, _ := resolvePath(ev, []string{"time"})
		ts, _ := tsAny.(int64)

		if agg.Count == 0 {
			agg.FirstTS = ts
			bestLastTS = ts - 1 // guarantees the first match always updates Last below
		} else if ts < agg.FirstTS {
			agg.FirstTS = ts
		}
		agg.Count++

		// Track the latest-timestamp match's tracked fields. Ties keep
		// whichever event was processed last, matching "last one wins"
		// as plainly as possible.
		if ts >= bestLastTS {
			bestLastTS = ts
			agg.LastTS = ts
			for _, f := range src.TrackLast {
				if v, ok := resolvePath(ev, splitPath(f)); ok {
					agg.Last[fieldAlias(f)] = v
				}
			}
		}

		for _, f := range src.TrackDistinct {
			v, ok := resolvePath(ev, splitPath(f))
			if !ok {
				continue
			}
			set := distinctSets[f]
			if set == nil {
				set = map[string]struct{}{}
				distinctSets[f] = set
			}
			set[renderScalar(v)] = struct{}{}
		}
	}

	for f, set := range distinctSets {
		agg.Distinct[fieldAlias(f)] = int64(len(set))
	}
	return agg, nil
}
