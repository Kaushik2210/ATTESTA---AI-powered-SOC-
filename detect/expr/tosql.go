package expr

import (
	"fmt"
	"strconv"
	"strings"
)

// ColumnResolver maps a dotted identifier path to a SQL column reference
// (e.g. ["failures", "count"] -> "f.count", or a raw event field path
// like ["actor","user","uid"] -> "actor_user_uid" for a `where` clause
// evaluated directly against the flattened events table). Returning an
// error rejects a path the SQL compiler doesn't know how to render —
// deliberately explicit rather than silently emitting something wrong.
type ColumnResolver func(path []string) (string, error)

// FuncSQL renders a builtin function call to SQL. Returns an error for a
// function that has no SQL rendering (deliberately explicit, same
// reasoning as ColumnResolver).
type FuncSQL func(args []string) (string, error)

// ToSQL renders an expression as a SQL boolean/arithmetic expression
// string. This is the other half of the CDL compiler: the SAME parsed
// AST that Eval walks directly for the streaming path is rendered here
// into SQL text for the retro-hunt/batch path — one rule definition,
// two independently-executed targets, checked against each other by
// detect's equivalence tests rather than trusted to stay in sync by hand.
func ToSQL(node Node, cols ColumnResolver, funcs map[string]FuncSQL) (string, error) {
	switch n := node.(type) {
	case Literal:
		return literalSQL(n.Value)
	case Ident:
		return cols(n.Path)
	case ListLit:
		parts := make([]string, len(n.Items))
		for i, item := range n.Items {
			s, err := ToSQL(item, cols, funcs)
			if err != nil {
				return "", err
			}
			parts[i] = s
		}
		return "(" + strings.Join(parts, ", ") + ")", nil
	case Call:
		fn, ok := funcs[n.Func]
		if !ok {
			return "", fmt.Errorf("expr: no SQL rendering registered for function %q", n.Func)
		}
		args := make([]string, len(n.Args))
		for i, a := range n.Args {
			s, err := ToSQL(a, cols, funcs)
			if err != nil {
				return "", err
			}
			args[i] = s
		}
		return fn(args)
	case Unary:
		x, err := ToSQL(n.X, cols, funcs)
		if err != nil {
			return "", err
		}
		switch n.Op {
		case "not":
			return "(NOT " + x + ")", nil
		case "-":
			return "(-" + x + ")", nil
		default:
			return "", fmt.Errorf("expr: unknown unary operator %q", n.Op)
		}
	case Binary:
		return binarySQL(n, cols, funcs)
	default:
		return "", fmt.Errorf("expr: unhandled node type %T", node)
	}
}

func literalSQL(v any) (string, error) {
	switch t := v.(type) {
	case int64:
		return strconv.FormatInt(t, 10), nil
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64), nil
	case bool:
		if t {
			return "1", nil
		}
		return "0", nil
	case string:
		// Single-quote escaping per standard SQL: double any embedded
		// single quote. Values here always come from rule YAML authored
		// by the maintainer, not from telemetry, but escaping is table
		// stakes regardless of provenance.
		return "'" + strings.ReplaceAll(t, "'", "''") + "'", nil
	default:
		return "", fmt.Errorf("expr: no SQL rendering for literal type %T", v)
	}
}

var sqlBinaryOps = map[string]string{
	"==": "=", "!=": "!=", ">": ">", ">=": ">=", "<": "<", "<=": "<=",
	"+": "+", "-": "-", "*": "*", "/": "/",
}

func binarySQL(n Binary, cols ColumnResolver, funcs map[string]FuncSQL) (string, error) {
	l, err := ToSQL(n.L, cols, funcs)
	if err != nil {
		return "", err
	}
	r, err := ToSQL(n.R, cols, funcs)
	if err != nil {
		return "", err
	}
	switch n.Op {
	case "and":
		return "(" + l + " AND " + r + ")", nil
	case "or":
		return "(" + l + " OR " + r + ")", nil
	case "in":
		return "(" + l + " IN " + r + ")", nil
	default:
		sqlOp, ok := sqlBinaryOps[n.Op]
		if !ok {
			return "", fmt.Errorf("expr: unknown binary operator %q", n.Op)
		}
		if n.Op == "/" {
			// Match Eval's true-division semantics (always float) --
			// SQLite (and ClickHouse) integer division truncates, so
			// force a floating-point divide.
			return "(CAST(" + l + " AS REAL) / CAST(" + r + " AS REAL))", nil
		}
		return "(" + l + " " + sqlOp + " " + r + ")", nil
	}
}
