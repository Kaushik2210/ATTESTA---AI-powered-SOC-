use crate::cbor::{encode_canonical, Value};

pub type EvidenceId = [u8; 32];

/// BLAKE3(canonical_cbor(event)) — docs/ARCHITECTURE.md §2.2. Uses the
/// official `blake3` crate (a different implementation than Go's
/// lukechampine.com/blake3); both conform to the same published BLAKE3
/// spec, so identical input bytes are guaranteed to produce identical
/// output regardless of which implementation computed it.
pub fn hash_evidence(canonical: &[u8]) -> EvidenceId {
    *blake3::hash(canonical).as_bytes()
}

pub fn new_evidence_id(v: &Value) -> (EvidenceId, Vec<u8>) {
    let canonical = encode_canonical(v);
    let id = hash_evidence(&canonical);
    (id, canonical)
}

const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";

pub fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX_CHARS[(b >> 4) as usize] as char);
        s.push(HEX_CHARS[(b & 0x0f) as usize] as char);
    }
    s
}

pub fn from_hex(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 {
        return Err(format!("odd-length hex string: {s}"));
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    for chunk in bytes.chunks(2) {
        let hi = hex_val(chunk[0])?;
        let lo = hex_val(chunk[1])?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}

fn hex_val(c: u8) -> Result<u8, String> {
    match c {
        b'0'..=b'9' => Ok(c - b'0'),
        b'a'..=b'f' => Ok(c - b'a' + 10),
        b'A'..=b'F' => Ok(c - b'A' + 10),
        _ => Err(format!("invalid hex digit: {}", c as char)),
    }
}

/// The identifier format the rest of the product displays —
/// docs/UI-SPEC.md's Investigation Canvas: "a copyable blake3:... identifier".
pub fn evidence_id_string(id: &EvidenceId) -> String {
    format!("blake3:{}", to_hex(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_roundtrip() {
        let bytes = [0x00u8, 0x01, 0xde, 0xad, 0xff];
        let hex = to_hex(&bytes);
        assert_eq!(hex, "0001deadff");
        assert_eq!(from_hex(&hex).unwrap(), bytes.to_vec());
    }
}
