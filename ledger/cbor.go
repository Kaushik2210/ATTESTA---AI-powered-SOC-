package ledger

import (
	"encoding/binary"
	"fmt"
	"sort"
)

// EncodeCanonical produces a deterministic CBOR encoding of v per RFC 8949's
// Core Deterministic Encoding Requirements (§4.2.1): every integer uses its
// shortest valid form, arrays and maps use definite lengths, and map keys
// are sorted by the bytewise lexicographic order of their own encoded
// bytes — not the original string, and not length-first (that was the
// older RFC 7049 canonical rule; RFC 8949 changed it).
//
// Supported types: nil, bool, int64, uint64, string, []byte, []any,
// map[string]any. Floats are deliberately unsupported. docs/ARCHITECTURE.md
// §2.2 requires fixed-point encoding wherever a value would otherwise need
// a fraction, precisely so this encoder never has to pick an IEEE-754
// canonicalization rule (NaN payloads, -0 vs 0, etc. all have more than one
// "correct" byte representation — the property this package exists to
// avoid).
func EncodeCanonical(v any) ([]byte, error) {
	return encodeValue(nil, v)
}

func encodeValue(buf []byte, v any) ([]byte, error) {
	switch t := v.(type) {
	case nil:
		return append(buf, 0xf6), nil // simple value 22 (null)
	case bool:
		if t {
			return append(buf, 0xf5), nil // simple value 21 (true)
		}
		return append(buf, 0xf4), nil // simple value 20 (false)
	case int:
		return encodeInt(buf, int64(t)), nil
	case int64:
		return encodeInt(buf, t), nil
	case uint64:
		return encodeHead(buf, 0, t), nil
	case string:
		return encodeBytesLike(buf, 3, []byte(t)), nil
	case []byte:
		return encodeBytesLike(buf, 2, t), nil
	case []any:
		buf = encodeHead(buf, 4, uint64(len(t)))
		var err error
		for _, item := range t {
			buf, err = encodeValue(buf, item)
			if err != nil {
				return nil, err
			}
		}
		return buf, nil
	case map[string]any:
		return encodeMap(buf, t)
	default:
		return nil, fmt.Errorf("ledger: canonical CBOR encoder does not support type %T (add fixed-point/typed handling explicitly — do not silently coerce)", v)
	}
}

func encodeInt(buf []byte, n int64) []byte {
	if n >= 0 {
		return encodeHead(buf, 0, uint64(n))
	}
	// CBOR major type 1 (negative integer) encodes the argument as
	// -(n+1); e.g. -1 encodes argument 0, -256 encodes argument 255.
	// n+1 cannot overflow int64 even at n == math.MinInt64: the result
	// (math.MinInt64+1) negates cleanly to math.MaxInt64.
	return encodeHead(buf, 1, uint64(-(n + 1)))
}

func encodeBytesLike(buf []byte, major byte, b []byte) []byte {
	buf = encodeHead(buf, major, uint64(len(b)))
	return append(buf, b...)
}

// encodeHead writes a CBOR major-type/argument head using the shortest
// valid form, as Core Deterministic Encoding requires (no non-shortest-form
// integers, no indefinite-length markers).
func encodeHead(buf []byte, major byte, n uint64) []byte {
	m := major << 5
	switch {
	case n < 24:
		return append(buf, m|byte(n))
	case n <= 0xff:
		return append(buf, m|24, byte(n))
	case n <= 0xffff:
		var b [2]byte
		binary.BigEndian.PutUint16(b[:], uint16(n))
		return append(append(buf, m|25), b[:]...)
	case n <= 0xffffffff:
		var b [4]byte
		binary.BigEndian.PutUint32(b[:], uint32(n))
		return append(append(buf, m|26), b[:]...)
	default:
		var b [8]byte
		binary.BigEndian.PutUint64(b[:], n)
		return append(append(buf, m|27), b[:]...)
	}
}

func encodeMap(buf []byte, m map[string]any) ([]byte, error) {
	type entry struct {
		encodedKey []byte
		value      any
	}
	entries := make([]entry, 0, len(m))
	for k, v := range m {
		entries = append(entries, entry{encodedKey: encodeBytesLike(nil, 3, []byte(k)), value: v})
	}
	// RFC 8949 §4.2.1 rule 3: sort by the bytewise lexicographic order of
	// each key's own deterministic encoding. This is what makes the
	// output independent of Go's (deliberately randomized) map iteration
	// order — see cbor_test.go's determinism property test.
	sort.Slice(entries, func(i, j int) bool {
		return bytesLess(entries[i].encodedKey, entries[j].encodedKey)
	})

	buf = encodeHead(buf, 5, uint64(len(entries)))
	var err error
	for _, e := range entries {
		buf = append(buf, e.encodedKey...)
		buf, err = encodeValue(buf, e.value)
		if err != nil {
			return nil, err
		}
	}
	return buf, nil
}

func bytesLess(a, b []byte) bool {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return len(a) < len(b)
}
