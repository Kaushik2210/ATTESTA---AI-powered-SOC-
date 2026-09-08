package expr

import (
	"fmt"
	"testing"
)

// testEnv resolves dotted paths against a nested map[string]any, and is
// used only by this package's own tests -- detect/ has its own Env
// implementations for real event/aggregate resolution.
type testEnv map[string]any

func (e testEnv) Resolve(path []string) (any, error) {
	var cur any = map[string]any(e)
	for _, seg := range path {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("path segment %q: not a map", seg)
		}
		v, exists := m[seg]
		if !exists {
			return nil, fmt.Errorf("unknown field %q", seg)
		}
		cur = v
	}
	return cur, nil
}

func testFuncs() map[string]Func {
	groups := map[string][]any{
		"ci-runners": {"198.51.100.9"},
	}
	return map[string]Func{
		"asset_group": func(args []any) (any, error) {
			if len(args) != 1 {
				return nil, fmt.Errorf("asset_group takes exactly 1 argument")
			}
			name, ok := args[0].(string)
			if !ok {
				return nil, fmt.Errorf("asset_group argument must be a string")
			}
			return groups[name], nil
		},
	}
}

func mustEval(t *testing.T, src string, env Env) any {
	t.Helper()
	node, err := Parse(src)
	if err != nil {
		t.Fatalf("Parse(%q): %v", src, err)
	}
	v, err := Eval(node, &Context{Env: env, Funcs: testFuncs()})
	if err != nil {
		t.Fatalf("Eval(%q): %v", src, err)
	}
	return v
}

func TestEval_Comparisons(t *testing.T) {
	env := testEnv{"failures": map[string]any{"count": int64(12)}}
	cases := []struct {
		src  string
		want bool
	}{
		{"failures.count >= 10", true},
		{"failures.count >= 13", false},
		{"failures.count == 12", true},
		{"failures.count != 12", false},
		{"failures.count < 12", false},
		{"failures.count <= 12", true},
	}
	for _, tc := range cases {
		got := mustEval(t, tc.src, env)
		if got != tc.want {
			t.Errorf("%q = %v, want %v", tc.src, got, tc.want)
		}
	}
}

func TestEval_BooleanLogic(t *testing.T) {
	env := testEnv{"a": true, "b": false}
	cases := []struct {
		src  string
		want bool
	}{
		{"a and b", false},
		{"a or b", true},
		{"not b", true},
		{"a and not b", true},
		{"(a or b) and not b", true},
	}
	for _, tc := range cases {
		got := mustEval(t, tc.src, env)
		if got != tc.want {
			t.Errorf("%q = %v, want %v", tc.src, got, tc.want)
		}
	}
}

func TestEval_ShortCircuit(t *testing.T) {
	// "or" must not evaluate the right side once the left is true --
	// modeled here by referencing an undefined field on the right, which
	// would error if evaluated.
	env := testEnv{"a": true}
	node, err := Parse("a or undefined_field")
	if err != nil {
		t.Fatal(err)
	}
	v, err := Eval(node, &Context{Env: env, Funcs: testFuncs()})
	if err != nil {
		t.Fatalf("expected short-circuit to avoid the error, got: %v", err)
	}
	if v != true {
		t.Fatalf("got %v, want true", v)
	}
}

func TestEval_Arithmetic(t *testing.T) {
	env := testEnv{
		"success":  map[string]any{"ts": int64(2000)},
		"failures": map[string]any{"last_ts": int64(1000)},
	}
	got := mustEval(t, "success.ts - failures.last_ts", env)
	if got != int64(1000) {
		t.Fatalf("got %v (%T), want int64(1000)", got, got)
	}
}

func TestEval_DivisionAlwaysFloat(t *testing.T) {
	env := testEnv{"a": int64(10), "b": int64(4)}
	got := mustEval(t, "a / b", env)
	f, ok := got.(float64)
	if !ok {
		t.Fatalf("division did not produce a float64, got %T", got)
	}
	if f != 2.5 {
		t.Fatalf("got %v, want 2.5", f)
	}
}

func TestEval_InOperatorAndListLiteral(t *testing.T) {
	env := testEnv{"ip": "203.0.113.44"}
	got := mustEval(t, `ip in ["203.0.113.44", "198.51.100.9"]`, env)
	if got != true {
		t.Fatalf("got %v, want true", got)
	}
	got2 := mustEval(t, `ip in ["10.0.0.1"]`, env)
	if got2 != false {
		t.Fatalf("got %v, want false", got2)
	}
}

func TestEval_FunctionCall(t *testing.T) {
	env := testEnv{"ip": "198.51.100.9"}
	got := mustEval(t, `ip in asset_group("ci-runners")`, env)
	if got != true {
		t.Fatalf("got %v, want true", got)
	}
}

func TestEval_RejectsFloatMixedWithNonNumericCompare(t *testing.T) {
	env := testEnv{"a": "not-a-number"}
	node, err := Parse("a > 1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Eval(node, &Context{Env: env, Funcs: testFuncs()}); err == nil {
		t.Fatal("expected an error comparing a string to a number")
	}
}

func TestParse_KnownVectorPrecedence(t *testing.T) {
	// "not" binds tighter than "and", which binds tighter than "or";
	// comparisons bind tighter than all boolean operators; arithmetic
	// binds tighter than comparisons.
	env := testEnv{"x": int64(5)}
	got := mustEval(t, "x > 1 + 1 and not (x > 10) or false", env)
	// x > 2 (true) and not(false) (true) => true; true or false => true
	if got != true {
		t.Fatalf("got %v, want true", got)
	}
}

func TestToSQL_MatchesEvalSemantics(t *testing.T) {
	node, err := Parse(`failures.count >= 10 and success.exists`)
	if err != nil {
		t.Fatal(err)
	}
	cols := func(path []string) (string, error) {
		switch {
		case path[0] == "failures" && path[1] == "count":
			return "f.count", nil
		case path[0] == "success" && path[1] == "exists":
			return "s.exists", nil
		default:
			return "", fmt.Errorf("unmapped column %v", path)
		}
	}
	sql, err := ToSQL(node, cols, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := "((f.count >= 10) AND s.exists)"
	if sql != want {
		t.Fatalf("got %q, want %q", sql, want)
	}
}

func TestToSQL_DivisionMatchesFloatSemantics(t *testing.T) {
	node, err := Parse("a / b")
	if err != nil {
		t.Fatal(err)
	}
	cols := func(path []string) (string, error) { return path[0], nil }
	sql, err := ToSQL(node, cols, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := "(CAST(a AS REAL) / CAST(b AS REAL))"
	if sql != want {
		t.Fatalf("got %q, want %q", sql, want)
	}
}
