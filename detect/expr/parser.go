package expr

import "fmt"

// Parse compiles a CDL expression string into an AST. Grammar (lowest to
// highest precedence): or, and, not, comparison (==, !=, >, >=, <, <=, in),
// additive (+, -), multiplicative (*, /), unary (-), primary (literals,
// dotted identifiers, calls, parens, list literals).
func Parse(src string) (Node, error) {
	toks, err := newLexer(src).tokens()
	if err != nil {
		return nil, err
	}
	p := &parser{toks: toks}
	node, err := p.parseOr()
	if err != nil {
		return nil, err
	}
	if p.cur().kind != tokEOF {
		return nil, fmt.Errorf("expr: unexpected trailing input at token %d (%q)", p.pos, p.cur().text)
	}
	return node, nil
}

type parser struct {
	toks []token
	pos  int
}

func (p *parser) cur() token { return p.toks[p.pos] }

func (p *parser) advance() token {
	t := p.toks[p.pos]
	if p.pos < len(p.toks)-1 {
		p.pos++
	}
	return t
}

func (p *parser) expect(k tokenKind, what string) error {
	if p.cur().kind != k {
		return fmt.Errorf("expr: expected %s at token %d, got %q", what, p.pos, p.cur().text)
	}
	p.advance()
	return nil
}

func (p *parser) parseOr() (Node, error) {
	left, err := p.parseAnd()
	if err != nil {
		return nil, err
	}
	for p.cur().kind == tokOr {
		p.advance()
		right, err := p.parseAnd()
		if err != nil {
			return nil, err
		}
		left = Binary{Op: "or", L: left, R: right}
	}
	return left, nil
}

func (p *parser) parseAnd() (Node, error) {
	left, err := p.parseNot()
	if err != nil {
		return nil, err
	}
	for p.cur().kind == tokAnd {
		p.advance()
		right, err := p.parseNot()
		if err != nil {
			return nil, err
		}
		left = Binary{Op: "and", L: left, R: right}
	}
	return left, nil
}

func (p *parser) parseNot() (Node, error) {
	if p.cur().kind == tokNot {
		p.advance()
		x, err := p.parseNot()
		if err != nil {
			return nil, err
		}
		return Unary{Op: "not", X: x}, nil
	}
	return p.parseComparison()
}

var comparisonOps = map[tokenKind]string{
	tokEq: "==", tokNeq: "!=", tokGt: ">", tokGte: ">=", tokLt: "<", tokLte: "<=", tokIn: "in",
}

func (p *parser) parseComparison() (Node, error) {
	left, err := p.parseAdditive()
	if err != nil {
		return nil, err
	}
	if op, ok := comparisonOps[p.cur().kind]; ok {
		p.advance()
		right, err := p.parseAdditive()
		if err != nil {
			return nil, err
		}
		return Binary{Op: op, L: left, R: right}, nil
	}
	return left, nil
}

func (p *parser) parseAdditive() (Node, error) {
	left, err := p.parseMultiplicative()
	if err != nil {
		return nil, err
	}
	for p.cur().kind == tokPlus || p.cur().kind == tokMinus {
		op := "+"
		if p.cur().kind == tokMinus {
			op = "-"
		}
		p.advance()
		right, err := p.parseMultiplicative()
		if err != nil {
			return nil, err
		}
		left = Binary{Op: op, L: left, R: right}
	}
	return left, nil
}

func (p *parser) parseMultiplicative() (Node, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	for p.cur().kind == tokStar || p.cur().kind == tokSlash {
		op := "*"
		if p.cur().kind == tokSlash {
			op = "/"
		}
		p.advance()
		right, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		left = Binary{Op: op, L: left, R: right}
	}
	return left, nil
}

func (p *parser) parseUnary() (Node, error) {
	if p.cur().kind == tokMinus {
		p.advance()
		x, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return Unary{Op: "-", X: x}, nil
	}
	return p.parsePrimary()
}

func (p *parser) parsePrimary() (Node, error) {
	tok := p.cur()
	switch tok.kind {
	case tokNumber:
		p.advance()
		if tok.isInt {
			return Literal{Value: int64(tok.num)}, nil
		}
		return Literal{Value: tok.num}, nil
	case tokString:
		p.advance()
		return Literal{Value: tok.text}, nil
	case tokTrue:
		p.advance()
		return Literal{Value: true}, nil
	case tokFalse:
		p.advance()
		return Literal{Value: false}, nil
	case tokLParen:
		p.advance()
		inner, err := p.parseOr()
		if err != nil {
			return nil, err
		}
		if err := p.expect(tokRParen, "')'"); err != nil {
			return nil, err
		}
		return inner, nil
	case tokLBracket:
		p.advance()
		var items []Node
		if p.cur().kind != tokRBracket {
			for {
				item, err := p.parseOr()
				if err != nil {
					return nil, err
				}
				items = append(items, item)
				if p.cur().kind != tokComma {
					break
				}
				p.advance()
			}
		}
		if err := p.expect(tokRBracket, "']'"); err != nil {
			return nil, err
		}
		return ListLit{Items: items}, nil
	case tokIdent:
		name := tok.text
		p.advance()
		if p.cur().kind == tokLParen {
			p.advance()
			var args []Node
			if p.cur().kind != tokRParen {
				for {
					arg, err := p.parseOr()
					if err != nil {
						return nil, err
					}
					args = append(args, arg)
					if p.cur().kind != tokComma {
						break
					}
					p.advance()
				}
			}
			if err := p.expect(tokRParen, "')'"); err != nil {
				return nil, err
			}
			return Call{Func: name, Args: args}, nil
		}
		path := []string{name}
		for p.cur().kind == tokDot {
			p.advance()
			if p.cur().kind != tokIdent {
				return nil, fmt.Errorf("expr: expected identifier after '.' at token %d", p.pos)
			}
			path = append(path, p.cur().text)
			p.advance()
		}
		return Ident{Path: path}, nil
	default:
		return nil, fmt.Errorf("expr: unexpected token %q at position %d", tok.text, p.pos)
	}
}
