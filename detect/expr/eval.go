package expr

import "fmt"

// Env resolves a dotted identifier path to a runtime value. Two
// implementations exist in detect/: one resolving into a raw normalized
// event (for `where` clauses, evaluated per-event) and one resolving into
// a source's computed Aggregate (for `when`/`observed`, evaluated once
// per correlation case).
type Env interface {
	Resolve(path []string) (any, error)
}

// Func is a CDL builtin function, e.g. asset_group(name).
type Func func(args []any) (any, error)

// Context bundles an Env with the function registry available during
// evaluation.
type Context struct {
	Env   Env
	Funcs map[string]Func
}

// EvalBool evaluates an expression and requires the result to be a bool —
// the entry point for `where`, `when`, and `suppress.when` fields, which
// are always boolean conditions.
func EvalBool(node Node, ctx *Context) (bool, error) {
	v, err := Eval(node, ctx)
	if err != nil {
		return false, err
	}
	b, ok := v.(bool)
	if !ok {
		return false, fmt.Errorf("expr: expected a boolean result, got %T (%v)", v, v)
	}
	return b, nil
}

// Eval evaluates an expression to a runtime value: int64, float64,
// string, bool, or []any (list literal results, only meaningful on the
// right-hand side of `in`).
func Eval(node Node, ctx *Context) (any, error) {
	switch n := node.(type) {
	case Literal:
		return n.Value, nil
	case Ident:
		return ctx.Env.Resolve(n.Path)
	case ListLit:
		items := make([]any, len(n.Items))
		for i, item := range n.Items {
			v, err := Eval(item, ctx)
			if err != nil {
				return nil, err
			}
			items[i] = v
		}
		return items, nil
	case Call:
		fn, ok := ctx.Funcs[n.Func]
		if !ok {
			return nil, fmt.Errorf("expr: unknown function %q", n.Func)
		}
		args := make([]any, len(n.Args))
		for i, a := range n.Args {
			v, err := Eval(a, ctx)
			if err != nil {
				return nil, err
			}
			args[i] = v
		}
		return fn(args)
	case Unary:
		return evalUnary(n, ctx)
	case Binary:
		return evalBinary(n, ctx)
	default:
		return nil, fmt.Errorf("expr: unhandled node type %T", node)
	}
}

func evalUnary(n Unary, ctx *Context) (any, error) {
	x, err := Eval(n.X, ctx)
	if err != nil {
		return nil, err
	}
	switch n.Op {
	case "not":
		b, ok := x.(bool)
		if !ok {
			return nil, fmt.Errorf("expr: 'not' requires a boolean, got %T", x)
		}
		return !b, nil
	case "-":
		switch v := x.(type) {
		case int64:
			return -v, nil
		case float64:
			return -v, nil
		default:
			return nil, fmt.Errorf("expr: unary '-' requires a number, got %T", x)
		}
	default:
		return nil, fmt.Errorf("expr: unknown unary operator %q", n.Op)
	}
}

func evalBinary(n Binary, ctx *Context) (any, error) {
	// and/or short-circuit, so they evaluate operands specially rather
	// than eagerly evaluating both sides up front.
	switch n.Op {
	case "and":
		l, err := EvalBool(n.L, ctx)
		if err != nil {
			return nil, err
		}
		if !l {
			return false, nil
		}
		return EvalBool(n.R, ctx)
	case "or":
		l, err := EvalBool(n.L, ctx)
		if err != nil {
			return nil, err
		}
		if l {
			return true, nil
		}
		return EvalBool(n.R, ctx)
	}

	l, err := Eval(n.L, ctx)
	if err != nil {
		return nil, err
	}
	r, err := Eval(n.R, ctx)
	if err != nil {
		return nil, err
	}

	switch n.Op {
	case "==":
		return valuesEqual(l, r), nil
	case "!=":
		return !valuesEqual(l, r), nil
	case ">", ">=", "<", "<=":
		return compareNumeric(n.Op, l, r)
	case "+", "-", "*", "/":
		return arithmetic(n.Op, l, r)
	case "in":
		list, ok := r.([]any)
		if !ok {
			return nil, fmt.Errorf("expr: 'in' requires a list on the right-hand side, got %T", r)
		}
		for _, item := range list {
			if valuesEqual(l, item) {
				return true, nil
			}
		}
		return false, nil
	default:
		return nil, fmt.Errorf("expr: unknown binary operator %q", n.Op)
	}
}

func valuesEqual(a, b any) bool {
	af, aok := asFloat(a)
	bf, bok := asFloat(b)
	if aok && bok {
		return af == bf
	}
	return a == b
}

func asFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case int64:
		return float64(t), true
	case float64:
		return t, true
	default:
		return 0, false
	}
}

func compareNumeric(op string, l, r any) (any, error) {
	lf, lok := asFloat(l)
	rf, rok := asFloat(r)
	if !lok || !rok {
		return nil, fmt.Errorf("expr: %q requires numeric operands, got %T and %T", op, l, r)
	}
	switch op {
	case ">":
		return lf > rf, nil
	case ">=":
		return lf >= rf, nil
	case "<":
		return lf < rf, nil
	case "<=":
		return lf <= rf, nil
	default:
		return nil, fmt.Errorf("expr: unknown comparison operator %q", op)
	}
}

// arithmetic keeps int64+int64 exact for +,-,* (fixed-point-friendly —
// docs/ARCHITECTURE.md §2.2's no-float rule applies to what ends up in a
// Claim's observed_value); division always produces float64, matching
// ordinary true-division semantics, since an exact integer quotient isn't
// guaranteed (e.g. computing a velocity).
func arithmetic(op string, l, r any) (any, error) {
	li, liok := l.(int64)
	ri, riok := r.(int64)
	if liok && riok && op != "/" {
		switch op {
		case "+":
			return li + ri, nil
		case "-":
			return li - ri, nil
		case "*":
			return li * ri, nil
		}
	}
	lf, lok := asFloat(l)
	rf, rok := asFloat(r)
	if !lok || !rok {
		return nil, fmt.Errorf("expr: %q requires numeric operands, got %T and %T", op, l, r)
	}
	switch op {
	case "+":
		return lf + rf, nil
	case "-":
		return lf - rf, nil
	case "*":
		return lf * rf, nil
	case "/":
		if rf == 0 {
			return nil, fmt.Errorf("expr: division by zero")
		}
		return lf / rf, nil
	default:
		return nil, fmt.Errorf("expr: unknown arithmetic operator %q", op)
	}
}
