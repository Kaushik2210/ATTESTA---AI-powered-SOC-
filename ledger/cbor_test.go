package ledger

import (
	"bytes"
	"testing"
)

// Every expected byte sequence below is hand-derived directly from the CBOR
// spec (RFC 8949 §3), not produced by the code under test — these are the
// ground-truth checks; the cross-language golden vectors in golden_test.go
// check agreement between implementations, which is a different property.
func TestEncodeCanonical_KnownVectors(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want []byte
	}{
		{"uint zero", int64(0), []byte{0x00}},
		{"uint boundary 23", int64(23), []byte{0x17}},
		{"uint boundary 24 (needs extra byte)", int64(24), []byte{0x18, 0x18}},
		{"uint 255", int64(255), []byte{0x18, 0xff}},
		{"uint 256 (needs 2-byte form)", int64(256), []byte{0x19, 0x01, 0x00}},
		{"negative -1", int64(-1), []byte{0x20}},
		{"negative -24 (last 1-byte form)", int64(-24), []byte{0x37}},
		{"negative -25 (needs extra byte)", int64(-25), []byte{0x38, 0x18}},
		{"empty string", "", []byte{0x60}},
		{"string a", "a", []byte{0x61, 0x61}},
		{"empty array", []any{}, []byte{0x80}},
		{"array 1,2,3", []any{int64(1), int64(2), int64(3)}, []byte{0x83, 0x01, 0x02, 0x03}},
		{"empty map", map[string]any{}, []byte{0xa0}},
		{"bool true", true, []byte{0xf5}},
		{"bool false", false, []byte{0xf4}},
		{"null", nil, []byte{0xf6}},
		{"bytes", []byte{0xde, 0xad}, []byte{0x42, 0xde, 0xad}},
		{
			"map with two keys, sorted a before b",
			map[string]any{"b": int64(2), "a": int64(1)},
			[]byte{0xa2, 0x61, 0x61, 0x01, 0x61, 0x62, 0x02},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := EncodeCanonical(tc.in)
			if err != nil {
				t.Fatalf("EncodeCanonical(%v) error: %v", tc.in, err)
			}
			if !bytes.Equal(got, tc.want) {
				t.Fatalf("EncodeCanonical(%v) = % x, want % x", tc.in, got, tc.want)
			}
		})
	}
}

// TestEncodeCanonical_KeyOrderIsBytewiseOnEncodedKey proves RFC 8949 §4.2.1's
// actual rule -- sort by the bytewise order of each key's OWN ENCODING, not
// by the raw string, and not length-first (the older RFC 7049 rule). "b" is
// a 1-character key (CBOR head byte 0x61); "a0" is a 2-character key (head
// byte 0x62). Raw-string order would put "a0" before "b" ('a' < 'b'). This
// encoder must put "b" before "a0" instead, because 0x61 < 0x62 regardless
// of what follows -- a wrong implementation choosing string-order or
// length-first-order would fail this test while still "looking canonical".
func TestEncodeCanonical_KeyOrderIsBytewiseOnEncodedKey(t *testing.T) {
	got, err := EncodeCanonical(map[string]any{
		"a0": int64(2),
		"b":  int64(1),
	})
	if err != nil {
		t.Fatalf("EncodeCanonical error: %v", err)
	}
	// map(2){ "b":1, "a0":2 }
	want := []byte{
		0xa2,
		0x61, 0x62, 0x01, // "b": 1
		0x62, 0x61, 0x30, 0x02, // "a0": 2
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("key order wrong: got % x, want % x", got, want)
	}
}

func TestEncodeCanonical_RejectsFloats(t *testing.T) {
	if _, err := EncodeCanonical(3.14); err == nil {
		t.Fatal("expected an error encoding a float64 — floats are deliberately unsupported (docs/ARCHITECTURE.md §2.2)")
	}
}

func TestEncodeCanonical_NegativeMinInt64DoesNotOverflow(t *testing.T) {
	// Regression guard for the encodeInt overflow edge case documented in
	// its comment: -(math.MinInt64+1) must not wrap around.
	const minInt64 = -9223372036854775808
	got, err := EncodeCanonical(int64(minInt64))
	if err != nil {
		t.Fatalf("EncodeCanonical(MinInt64) error: %v", err)
	}
	// major type 1, argument = -(MinInt64+1) = MaxInt64 = 0x7fffffffffffffff,
	// which needs the 8-byte form (prefix 27).
	want := []byte{0x3b, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}
	if !bytes.Equal(got, want) {
		t.Fatalf("EncodeCanonical(MinInt64) = % x, want % x", got, want)
	}
}
