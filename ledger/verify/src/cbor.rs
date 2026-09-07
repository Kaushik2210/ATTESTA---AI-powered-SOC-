//! Deterministic CBOR encoding — RFC 8949 Core Deterministic Encoding
//! Requirements (§4.2.1).
//!
//! This is an INDEPENDENT re-implementation of `ledger/cbor.go`'s exact
//! algorithm, not a shared library the two languages both call into.
//! Agreement between this and the Go implementation — proven by the
//! golden-vector test in `tests/golden.rs` — is what actually demonstrates
//! cross-language determinism. A shared library would only prove that one
//! implementation is self-consistent.

/// The canonical value shapes this encoder accepts. Deliberately no float
/// variant — docs/ARCHITECTURE.md §2.2 requires fixed-point wherever a
/// value would otherwise need a fraction, so this type can't even
/// represent one.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Int(i64),
    UInt(u64),
    Text(String),
    Bytes(Vec<u8>),
    Array(Vec<Value>),
    /// Insertion order does not matter — `encode_map` sorts by each key's
    /// own encoded bytes before emitting, exactly like ledger/cbor.go's
    /// encodeMap. A `BTreeMap<String, Value>` would sort by the RAW string
    /// instead, which is the wrong order (see cbor_test.go's
    /// TestEncodeCanonical_KeyOrderIsBytewiseOnEncodedKey) — that's why
    /// this is a plain Vec of pairs, not a BTreeMap.
    Map(Vec<(String, Value)>),
}

pub fn encode_canonical(v: &Value) -> Vec<u8> {
    let mut buf = Vec::new();
    encode_value(&mut buf, v);
    buf
}

fn encode_value(buf: &mut Vec<u8>, v: &Value) {
    match v {
        Value::Null => buf.push(0xf6),
        Value::Bool(true) => buf.push(0xf5),
        Value::Bool(false) => buf.push(0xf4),
        Value::Int(n) => encode_int(buf, *n),
        Value::UInt(n) => encode_head(buf, 0, *n),
        Value::Text(s) => encode_bytes_like(buf, 3, s.as_bytes()),
        Value::Bytes(b) => encode_bytes_like(buf, 2, b),
        Value::Array(items) => {
            encode_head(buf, 4, items.len() as u64);
            for item in items {
                encode_value(buf, item);
            }
        }
        Value::Map(entries) => encode_map(buf, entries),
    }
}

fn encode_int(buf: &mut Vec<u8>, n: i64) {
    if n >= 0 {
        encode_head(buf, 0, n as u64);
    } else {
        // CBOR major type 1 argument = -(n+1). Computed in i128 so this
        // cannot overflow even at n == i64::MIN (mirrors the comment in
        // ledger/cbor.go's encodeInt, and TestEncodeCanonical_NegativeMinInt64DoesNotOverflow).
        let arg = (-(n as i128) - 1) as u64;
        encode_head(buf, 1, arg);
    }
}

fn encode_bytes_like(buf: &mut Vec<u8>, major: u8, b: &[u8]) {
    encode_head(buf, major, b.len() as u64);
    buf.extend_from_slice(b);
}

/// Writes a CBOR major-type/argument head using the shortest valid form —
/// Core Deterministic Encoding forbids non-shortest-form integers and
/// indefinite-length markers.
fn encode_head(buf: &mut Vec<u8>, major: u8, n: u64) {
    let m = major << 5;
    if n < 24 {
        buf.push(m | (n as u8));
    } else if n <= 0xff {
        buf.push(m | 24);
        buf.push(n as u8);
    } else if n <= 0xffff {
        buf.push(m | 25);
        buf.extend_from_slice(&(n as u16).to_be_bytes());
    } else if n <= 0xffff_ffff {
        buf.push(m | 26);
        buf.extend_from_slice(&(n as u32).to_be_bytes());
    } else {
        buf.push(m | 27);
        buf.extend_from_slice(&n.to_be_bytes());
    }
}

fn encode_map(buf: &mut Vec<u8>, entries: &[(String, Value)]) {
    let mut encoded: Vec<(Vec<u8>, &Value)> = entries
        .iter()
        .map(|(k, v)| {
            let mut kbuf = Vec::new();
            encode_bytes_like(&mut kbuf, 3, k.as_bytes());
            (kbuf, v)
        })
        .collect();
    // RFC 8949 §4.2.1 rule 3: sort by the bytewise lexicographic order of
    // each key's own deterministic encoding. Vec<u8>'s Ord is exactly
    // bytewise lexicographic comparison, so a plain sort_by on the encoded
    // key bytes is correct here — matches ledger/cbor.go's bytesLess.
    encoded.sort_by(|a, b| a.0.cmp(&b.0));

    encode_head(buf, 5, encoded.len() as u64);
    for (kbytes, v) in encoded {
        buf.extend_from_slice(&kbytes);
        encode_value(buf, v);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Same ground-truth vectors as ledger/cbor_test.go's
    // TestEncodeCanonical_KnownVectors — hand-derived from RFC 8949 §3,
    // not from either implementation.
    #[test]
    fn known_vectors() {
        assert_eq!(encode_canonical(&Value::Int(0)), vec![0x00]);
        assert_eq!(encode_canonical(&Value::Int(23)), vec![0x17]);
        assert_eq!(encode_canonical(&Value::Int(24)), vec![0x18, 0x18]);
        assert_eq!(encode_canonical(&Value::Int(255)), vec![0x18, 0xff]);
        assert_eq!(encode_canonical(&Value::Int(256)), vec![0x19, 0x01, 0x00]);
        assert_eq!(encode_canonical(&Value::Int(-1)), vec![0x20]);
        assert_eq!(encode_canonical(&Value::Int(-24)), vec![0x37]);
        assert_eq!(encode_canonical(&Value::Int(-25)), vec![0x38, 0x18]);
        assert_eq!(encode_canonical(&Value::Text("".into())), vec![0x60]);
        assert_eq!(encode_canonical(&Value::Text("a".into())), vec![0x61, 0x61]);
        assert_eq!(encode_canonical(&Value::Array(vec![])), vec![0x80]);
        assert_eq!(
            encode_canonical(&Value::Array(vec![Value::Int(1), Value::Int(2), Value::Int(3)])),
            vec![0x83, 0x01, 0x02, 0x03]
        );
        assert_eq!(encode_canonical(&Value::Map(vec![])), vec![0xa0]);
        assert_eq!(encode_canonical(&Value::Bool(true)), vec![0xf5]);
        assert_eq!(encode_canonical(&Value::Bool(false)), vec![0xf4]);
        assert_eq!(encode_canonical(&Value::Null), vec![0xf6]);
        assert_eq!(
            encode_canonical(&Value::Bytes(vec![0xde, 0xad])),
            vec![0x42, 0xde, 0xad]
        );
    }

    #[test]
    fn map_sorted_by_encoded_key_not_raw_string() {
        // "b" (len 1, head 0x61) sorts before "a0" (len 2, head 0x62),
        // even though raw-string order would put "a0" first. See the
        // matching Go test for the full explanation.
        let got = encode_canonical(&Value::Map(vec![
            ("a0".into(), Value::Int(2)),
            ("b".into(), Value::Int(1)),
        ]));
        let want = vec![
            0xa2, 0x61, 0x62, 0x01, // "b": 1
            0x62, 0x61, 0x30, 0x02, // "a0": 2
        ];
        assert_eq!(got, want);
    }

    #[test]
    fn min_i64_does_not_overflow() {
        let got = encode_canonical(&Value::Int(i64::MIN));
        let want = vec![0x3b, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
        assert_eq!(got, want);
    }
}
