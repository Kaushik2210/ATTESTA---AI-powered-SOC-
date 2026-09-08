package detect

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
)

// LoadFixture reads a newline-delimited JSON event corpus (the same
// json.Number-based decoding ingest's pipeline uses, so where/group_by/
// track_* comparisons in a rule see the same value types both the
// streaming and SQL paths operate on) into the canonical value shapes
// ledger.EncodeCanonical accepts.
func LoadFixture(path string) ([]map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("detect: reading fixture %s: %w", path, err)
	}
	lines := bytes.Split(bytes.TrimRight(data, "\n"), []byte("\n"))
	events := make([]map[string]any, 0, len(lines))
	for i, line := range lines {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		ev, err := decodeFixtureLine(line)
		if err != nil {
			return nil, fmt.Errorf("detect: fixture %s line %d: %w", path, i, err)
		}
		events = append(events, ev)
	}
	return events, nil
}

func decodeFixtureLine(line []byte) (map[string]any, error) {
	dec := json.NewDecoder(bytes.NewReader(line))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	converted, err := jsonToCanonical(v)
	if err != nil {
		return nil, err
	}
	m, ok := converted.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("fixture line is not a JSON object")
	}
	return m, nil
}

// jsonToCanonical mirrors ingest's golden-fixture converter (they can't
// share code across packages without an import both would find odd, and
// it's small): numbers must be whole (floats are unsupported throughout
// this codebase), arrays/objects convert recursively.
func jsonToCanonical(v any) (any, error) {
	switch t := v.(type) {
	case nil, bool, string:
		return t, nil
	case json.Number:
		n, err := strconv.ParseInt(t.String(), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("fixture number %q is not a whole int64 (floats are unsupported): %w", t.String(), err)
		}
		return n, nil
	case []any:
		out := make([]any, len(t))
		for i, item := range t {
			c, err := jsonToCanonical(item)
			if err != nil {
				return nil, err
			}
			out[i] = c
		}
		return out, nil
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, item := range t {
			c, err := jsonToCanonical(item)
			if err != nil {
				return nil, err
			}
			out[k] = c
		}
		return out, nil
	default:
		return nil, fmt.Errorf("unsupported JSON value type %T", v)
	}
}

// ClaimKey is a Claim reduced to a comparable value, for order-independent
// set comparison between the streaming and SQL paths (and against a
// test's `expect` predicate list).
type ClaimKey struct {
	Predicate string
	Entity    string
	Observed  string
}

func renderObserved(v any) string {
	if v == nil {
		return "\x00null"
	}
	return fmt.Sprintf("%v", v)
}

// ClaimKeys reduces and sorts a claim set for comparison.
func ClaimKeys(claims []Claim) []ClaimKey {
	keys := make([]ClaimKey, len(claims))
	for i, c := range claims {
		keys[i] = ClaimKey{Predicate: c.Predicate, Entity: c.EntityValue, Observed: renderObserved(c.ObservedValue)}
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].Predicate != keys[j].Predicate {
			return keys[i].Predicate < keys[j].Predicate
		}
		if keys[i].Entity != keys[j].Entity {
			return keys[i].Entity < keys[j].Entity
		}
		return keys[i].Observed < keys[j].Observed
	})
	return keys
}

// PredicateSet reduces a claim set to its sorted, deduplicated predicate
// names — what a test's `expect` field is checked against.
func PredicateSet(claims []Claim) []string {
	seen := map[string]bool{}
	var out []string
	for _, c := range claims {
		if !seen[c.Predicate] {
			seen[c.Predicate] = true
			out = append(out, c.Predicate)
		}
	}
	sort.Strings(out)
	return out
}

func stringSetEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	as, bs := append([]string{}, a...), append([]string{}, b...)
	sort.Strings(as)
	sort.Strings(bs)
	for i := range as {
		if as[i] != bs[i] {
			return false
		}
	}
	return true
}

// RunFixtureTests runs every fixture a rule ships with through the
// streaming path and checks the resulting predicate set against
// `expect`. It does not run the SQL path — that's a separate, heavier
// equivalence check (RunEquivalence) run once per rule, not once per
// fixture, since it exercises the same property across every fixture at
// once.
func RunFixtureTests(rule *Rule) error {
	for _, test := range rule.Tests {
		events, err := LoadFixture(rule.FixturePath(test))
		if err != nil {
			return err
		}
		claims, err := EvaluateStreaming(rule, events)
		if err != nil {
			return fmt.Errorf("rule %s, fixture %s: %w", rule.ID, test.Fixture, err)
		}
		got := PredicateSet(claims)
		if !stringSetEqual(got, test.Expect) {
			return fmt.Errorf("rule %s, fixture %s: got predicates %v, want %v", rule.ID, test.Fixture, got, test.Expect)
		}
	}
	return nil
}

// RunEquivalence is the Phase 3 gate's equivalence test: "for each rule,
// the streaming path and the SQL path produce the identical claim set
// over the same fixture corpus." Runs both paths over every fixture the
// rule ships with and compares.
func RunEquivalence(rule *Rule) error {
	for _, test := range rule.Tests {
		events, err := LoadFixture(rule.FixturePath(test))
		if err != nil {
			return err
		}
		streamClaims, err := EvaluateStreaming(rule, events)
		if err != nil {
			return fmt.Errorf("rule %s, fixture %s: streaming: %w", rule.ID, test.Fixture, err)
		}
		sqlClaims, err := RunSQL(rule, events)
		if err != nil {
			return fmt.Errorf("rule %s, fixture %s: SQL: %w", rule.ID, test.Fixture, err)
		}
		streamKeys := ClaimKeys(streamClaims)
		sqlKeys := ClaimKeys(sqlClaims)
		if len(streamKeys) != len(sqlKeys) {
			return fmt.Errorf("rule %s, fixture %s: streaming produced %d claims, SQL produced %d\nstreaming: %+v\nsql: %+v", rule.ID, test.Fixture, len(streamKeys), len(sqlKeys), streamKeys, sqlKeys)
		}
		for i := range streamKeys {
			if streamKeys[i] != sqlKeys[i] {
				return fmt.Errorf("rule %s, fixture %s: claim sets differ\nstreaming: %+v\nsql: %+v", rule.ID, test.Fixture, streamKeys, sqlKeys)
			}
		}
	}
	return nil
}
