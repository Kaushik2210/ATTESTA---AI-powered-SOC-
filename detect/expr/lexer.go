// Package expr implements CDL's expression language — the small
// boolean/arithmetic DSL used in a rule's `where`, `when`, `observed`, and
// `suppress.when` fields (docs/DETECTION-SPEC.md). It is compiled to two
// independent targets: a direct Go evaluator (Eval, for the streaming
// engine) and a SQL string (ToSQL, for the ClickHouse-dialect-portable
// batch/retro-hunt path) — see detect/streaming.go and detect/sql.go.
// Compiling the SAME parsed expression to both targets, rather than
// hand-writing SQL separately, is what makes "what would this rule have
// caught last quarter?" a trustworthy question instead of a second,
// driftable implementation.
package expr

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

type tokenKind int

const (
	tokEOF tokenKind = iota
	tokIdent
	tokNumber
	tokString
	tokAnd
	tokOr
	tokNot
	tokIn
	tokTrue
	tokFalse
	tokDot
	tokComma
	tokLParen
	tokRParen
	tokLBracket
	tokRBracket
	tokEq
	tokNeq
	tokGt
	tokGte
	tokLt
	tokLte
	tokPlus
	tokMinus
	tokStar
	tokSlash
)

type token struct {
	kind tokenKind
	text string
	num  float64
	isInt bool
}

var keywords = map[string]tokenKind{
	"and":   tokAnd,
	"or":    tokOr,
	"not":   tokNot,
	"in":    tokIn,
	"true":  tokTrue,
	"false": tokFalse,
}

type lexer struct {
	src string
	pos int
}

func newLexer(src string) *lexer { return &lexer{src: src} }

func (l *lexer) peekByte() byte {
	if l.pos >= len(l.src) {
		return 0
	}
	return l.src[l.pos]
}

func (l *lexer) tokens() ([]token, error) {
	var out []token
	for {
		tok, err := l.next()
		if err != nil {
			return nil, err
		}
		out = append(out, tok)
		if tok.kind == tokEOF {
			return out, nil
		}
	}
}

func (l *lexer) next() (token, error) {
	l.skipSpace()
	if l.pos >= len(l.src) {
		return token{kind: tokEOF}, nil
	}
	c := l.src[l.pos]

	switch {
	case c == '(':
		l.pos++
		return token{kind: tokLParen}, nil
	case c == ')':
		l.pos++
		return token{kind: tokRParen}, nil
	case c == '[':
		l.pos++
		return token{kind: tokLBracket}, nil
	case c == ']':
		l.pos++
		return token{kind: tokRBracket}, nil
	case c == ',':
		l.pos++
		return token{kind: tokComma}, nil
	case c == '.':
		// A leading digit-dot (e.g. ".5") is not supported — CDL numbers
		// are always written with a leading digit. "." on its own is
		// only the identifier path separator.
		l.pos++
		return token{kind: tokDot}, nil
	case c == '+':
		l.pos++
		return token{kind: tokPlus}, nil
	case c == '-':
		l.pos++
		return token{kind: tokMinus}, nil
	case c == '*':
		l.pos++
		return token{kind: tokStar}, nil
	case c == '/':
		l.pos++
		return token{kind: tokSlash}, nil
	case c == '=':
		if l.peekAt(1) == '=' {
			l.pos += 2
			return token{kind: tokEq}, nil
		}
		return token{}, fmt.Errorf("expr: unexpected '=' at position %d (did you mean '=='?)", l.pos)
	case c == '!':
		if l.peekAt(1) == '=' {
			l.pos += 2
			return token{kind: tokNeq}, nil
		}
		return token{}, fmt.Errorf("expr: unexpected '!' at position %d", l.pos)
	case c == '>':
		if l.peekAt(1) == '=' {
			l.pos += 2
			return token{kind: tokGte}, nil
		}
		l.pos++
		return token{kind: tokGt}, nil
	case c == '<':
		if l.peekAt(1) == '=' {
			l.pos += 2
			return token{kind: tokLte}, nil
		}
		l.pos++
		return token{kind: tokLt}, nil
	case c == '"' || c == '\'':
		return l.lexString(c)
	case c >= '0' && c <= '9':
		return l.lexNumber()
	case isIdentStart(rune(c)):
		return l.lexIdentOrKeyword()
	default:
		return token{}, fmt.Errorf("expr: unexpected character %q at position %d", c, l.pos)
	}
}

func (l *lexer) peekAt(offset int) byte {
	if l.pos+offset >= len(l.src) {
		return 0
	}
	return l.src[l.pos+offset]
}

func (l *lexer) skipSpace() {
	for l.pos < len(l.src) {
		r, size := utf8.DecodeRuneInString(l.src[l.pos:])
		if !unicode.IsSpace(r) {
			return
		}
		l.pos += size
	}
}

func isIdentStart(r rune) bool {
	return r == '_' || unicode.IsLetter(r)
}

func isIdentCont(r rune) bool {
	return r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r)
}

func (l *lexer) lexIdentOrKeyword() (token, error) {
	start := l.pos
	for l.pos < len(l.src) {
		r, size := utf8.DecodeRuneInString(l.src[l.pos:])
		if !isIdentCont(r) {
			break
		}
		l.pos += size
	}
	text := l.src[start:l.pos]
	if kind, ok := keywords[text]; ok {
		return token{kind: kind, text: text}, nil
	}
	return token{kind: tokIdent, text: text}, nil
}

func (l *lexer) lexNumber() (token, error) {
	start := l.pos
	isFloat := false
	for l.pos < len(l.src) && l.src[l.pos] >= '0' && l.src[l.pos] <= '9' {
		l.pos++
	}
	if l.pos < len(l.src) && l.src[l.pos] == '.' && l.peekAt(1) >= '0' && l.peekAt(1) <= '9' {
		isFloat = true
		l.pos++
		for l.pos < len(l.src) && l.src[l.pos] >= '0' && l.src[l.pos] <= '9' {
			l.pos++
		}
	}
	text := l.src[start:l.pos]
	n, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return token{}, fmt.Errorf("expr: invalid number %q: %w", text, err)
	}
	return token{kind: tokNumber, num: n, isInt: !isFloat, text: text}, nil
}

func (l *lexer) lexString(quote byte) (token, error) {
	l.pos++ // consume opening quote
	var b strings.Builder
	for {
		if l.pos >= len(l.src) {
			return token{}, fmt.Errorf("expr: unterminated string literal")
		}
		c := l.src[l.pos]
		if c == quote {
			l.pos++
			return token{kind: tokString, text: b.String()}, nil
		}
		if c == '\\' && l.peekAt(1) != 0 {
			l.pos++
			b.WriteByte(l.src[l.pos])
			l.pos++
			continue
		}
		b.WriteByte(c)
		l.pos++
	}
}
