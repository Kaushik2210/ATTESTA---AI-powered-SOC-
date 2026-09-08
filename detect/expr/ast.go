package expr

// Node is any parsed expression node. The set is deliberately small —
// exactly what docs/DETECTION-SPEC.md's rule fields need, not a general
// scripting language.
type Node interface {
	isNode()
}

// Ident is a dotted field path, e.g. "failures.count" -> ["failures","count"].
type Ident struct {
	Path []string
}

// Literal is a number (int64 or float64), string, or bool constant.
type Literal struct {
	Value any
}

// ListLit is a bracketed list literal, e.g. ["a", "b"] — used with `in`.
type ListLit struct {
	Items []Node
}

// Call is a function invocation, e.g. asset_group("ci-runners").
type Call struct {
	Func string
	Args []Node
}

// Unary is a prefix operator: "not" or "-".
type Unary struct {
	Op string
	X  Node
}

// Binary is an infix operator: and, or, ==, !=, >, >=, <, <=, +, -, *, /, in.
type Binary struct {
	Op string
	L  Node
	R  Node
}

func (Ident) isNode()   {}
func (Literal) isNode() {}
func (ListLit) isNode() {}
func (Call) isNode()    {}
func (Unary) isNode()   {}
func (Binary) isNode()  {}
