//! Deterministic byte serialization for hashing — the kernel's own
//! minimal counterpart to ledger/verify's canonical CBOR encoder, not a
//! shared dependency on it. The kernel is a separate crate with its own
//! minimal dependency footprint (docs/ARCHITECTURE.md §2.8: the
//! determinism-verifier gate fails on ANY unexpected dependency in this
//! crate's tree), so this purpose-built, fixed-field-order encoder is
//! deliberately simpler than a general canonical-value encoder: every
//! field written is length- or width-prefixed so no field's content can
//! be mistaken for a boundary between fields, and the field order is
//! fixed by the function itself, not by iterating any collection.

pub fn write_str(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    buf.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    buf.extend_from_slice(bytes);
}

pub fn write_opt_str(buf: &mut Vec<u8>, s: &Option<String>) {
    match s {
        Some(v) => {
            buf.push(1);
            write_str(buf, v);
        }
        None => buf.push(0),
    }
}

pub fn write_i64(buf: &mut Vec<u8>, v: i64) {
    buf.extend_from_slice(&v.to_be_bytes());
}

pub fn write_opt_i64(buf: &mut Vec<u8>, v: Option<i64>) {
    match v {
        Some(n) => {
            buf.push(1);
            write_i64(buf, n);
        }
        None => buf.push(0),
    }
}

/// Writes a list of strings in a fixed, caller-determined order (callers
/// that need order-independence, e.g. a claim's evidence list, must sort
/// before calling this — see claim.rs) — this function itself never
/// reorders anything, so it can't hide a caller's ordering bug.
pub fn write_str_list(buf: &mut Vec<u8>, items: &[String]) {
    buf.extend_from_slice(&(items.len() as u32).to_be_bytes());
    for item in items {
        write_str(buf, item);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_str_is_length_prefixed_not_delimiter_based() {
        // Two different (field, field) pairs that would collide under
        // naive concatenation ("ab"+"c" vs "a"+"bc") must NOT collide
        // once length-prefixed.
        let mut a = Vec::new();
        write_str(&mut a, "ab");
        write_str(&mut a, "c");

        let mut b = Vec::new();
        write_str(&mut b, "a");
        write_str(&mut b, "bc");

        assert_ne!(a, b);
    }
}
