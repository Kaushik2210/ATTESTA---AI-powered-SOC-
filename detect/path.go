package detect

import (
	"strconv"
	"strings"
)

// resolvePath navigates a nested map[string]any by a dotted field path —
// the same normalized-event shape ingest.Mapping.Apply produces. Returns
// ok=false if any segment is absent, never an error: a rule's `where`
// clause referencing a field a given event doesn't carry is a normal,
// expected case (that event just doesn't match), not a rule bug.
func resolvePath(m map[string]any, path []string) (any, bool) {
	var cur any = m
	for _, seg := range path {
		cm, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		v, exists := cm[seg]
		if !exists {
			return nil, false
		}
		cur = v
	}
	return cur, true
}

// groupKey renders a group_by field-value tuple (looked up directly on a
// raw event) into a single comparable string key.
func groupKey(event map[string]any, fields []string) (string, bool) {
	return groupKeyFromGetter(func(path []string) (any, bool) {
		return resolvePath(event, path)
	}, fields)
}

// groupKeyFromGetter is groupKey generalized over any field-value source
// — used both for raw events (via groupKey above) and for a case's
// already-extracted union-field values (detect/streaming.go), so both
// share exactly one key-rendering implementation. Values are rendered via
// renderScalar; this is safe because CDL group_by fields are always one
// of the ledger-canonical scalar types (string, bool, int64, nil) —
// identity-like values (user id, IP, session id), never structured data.
func groupKeyFromGetter(get func(path []string) (any, bool), fields []string) (string, bool) {
	var b strings.Builder
	for i, f := range fields {
		v, ok := get(splitPath(f))
		if !ok {
			return "", false
		}
		if i > 0 {
			b.WriteByte('\x1f') // unit separator; never appears in real field values
		}
		b.WriteString(renderScalar(v))
	}
	return b.String(), true
}

func splitPath(dotted string) []string {
	return strings.Split(dotted, ".")
}

func renderScalar(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case int64:
		return strconv.FormatInt(t, 10)
	case bool:
		if t {
			return "true"
		}
		return "false"
	case nil:
		return "\x00null"
	default:
		return "\x00unsupported"
	}
}
