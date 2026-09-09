use crate::canon::{write_i64, write_opt_i64, write_opt_str, write_str, write_str_list};

/// A claim's polarity — docs/ARCHITECTURE.md §2.7: SUPPORTS contributes
/// positively to its tactic's score, REFUTES subtracts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum Polarity {
    Supports,
    Refutes,
}

impl Polarity {
    pub fn name(self) -> &'static str {
        match self {
            Polarity::Supports => "supports",
            Polarity::Refutes => "refutes",
        }
    }

    pub fn from_name(s: &str) -> Option<Polarity> {
        match s {
            "supports" => Some(Polarity::Supports),
            "refutes" => Some(Polarity::Refutes),
            _ => None,
        }
    }
}

/// One typed, evidence-cited assertion — docs/ARCHITECTURE.md §2.7's
/// Claim schema. This is a deliberately reduced form: `subject`/`object`
/// are plain entity-identifier strings rather than a structured
/// EntityRef, since nothing in the kernel's own logic needs to parse
/// them (that's the investigator/claim-gate's job) — the kernel only
/// ever compares, hashes, and sums, never interprets an entity
/// reference's internal structure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Claim {
    pub predicate: String,
    pub subject: String,
    pub object: Option<String>,
    pub interval_start_ns: i64,
    pub interval_end_ns: i64,
    /// Content hashes of evidence nodes this claim cites. Invariant I2
    /// ("no claim without evidence") is enforced upstream at the Claim
    /// Gate — the kernel never reaches a claim that violates it in a real
    /// deployment — but `Claim::new` still requires a non-empty list,
    /// because a pure function with an invariant it silently tolerates
    /// violations of is not really enforcing that invariant at all.
    pub evidence: Vec<String>,
    pub extractor_kind: String,
    pub extractor_id: String,
    pub extractor_version: String,
    pub observed_value: Option<i64>,
    pub polarity: Polarity,
    pub hypothesis_ref: Option<String>,
}

#[derive(Debug)]
pub struct EmptyEvidenceError;

impl Claim {
    /// Constructs a claim, rejecting one with an empty evidence list
    /// (I2) rather than silently accepting it — see the `evidence` field
    /// doc comment above.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        predicate: impl Into<String>,
        subject: impl Into<String>,
        object: Option<String>,
        interval_start_ns: i64,
        interval_end_ns: i64,
        evidence: Vec<String>,
        extractor_kind: impl Into<String>,
        extractor_id: impl Into<String>,
        extractor_version: impl Into<String>,
        observed_value: Option<i64>,
        polarity: Polarity,
        hypothesis_ref: Option<String>,
    ) -> Result<Self, EmptyEvidenceError> {
        if evidence.is_empty() {
            return Err(EmptyEvidenceError);
        }
        Ok(Claim {
            predicate: predicate.into(),
            subject: subject.into(),
            object,
            interval_start_ns,
            interval_end_ns,
            evidence,
            extractor_kind: extractor_kind.into(),
            extractor_id: extractor_id.into(),
            extractor_version: extractor_version.into(),
            observed_value,
            polarity,
            hypothesis_ref,
        })
    }

    /// claim_id = BLAKE3(canonical(self)) — docs/ARCHITECTURE.md §2.7.
    /// Evidence hashes are sorted before encoding so claim_id doesn't
    /// depend on the order the caller happened to list them in — the
    /// same "canonicalize away accidental ordering" discipline Phase 1's
    /// ledger applies to map keys.
    pub fn claim_id(&self) -> [u8; 32] {
        let mut buf = Vec::new();
        write_str(&mut buf, &self.predicate);
        write_str(&mut buf, &self.subject);
        write_opt_str(&mut buf, &self.object);
        write_i64(&mut buf, self.interval_start_ns);
        write_i64(&mut buf, self.interval_end_ns);

        let mut sorted_evidence = self.evidence.clone();
        sorted_evidence.sort();
        write_str_list(&mut buf, &sorted_evidence);

        write_str(&mut buf, &self.extractor_kind);
        write_str(&mut buf, &self.extractor_id);
        write_str(&mut buf, &self.extractor_version);
        write_opt_i64(&mut buf, self.observed_value);
        buf.push(self.polarity as u8);
        write_opt_str(&mut buf, &self.hypothesis_ref);

        *blake3::hash(&buf).as_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Claim {
        Claim::new(
            "AUTH_FAILED_BURST",
            "user:jdoe",
            None,
            1_000_000_000,
            2_000_000_000,
            vec!["blake3:aaaa".into(), "blake3:bbbb".into()],
            "rule",
            "cdl.credential.auth-burst-then-success",
            "1",
            Some(43),
            Polarity::Supports,
            None,
        )
        .unwrap()
    }

    #[test]
    fn rejects_empty_evidence() {
        let err = Claim::new(
            "AUTH_FAILED_BURST",
            "user:jdoe",
            None,
            0,
            0,
            vec![],
            "rule",
            "x",
            "1",
            None,
            Polarity::Supports,
            None,
        );
        assert!(err.is_err());
    }

    #[test]
    fn claim_id_is_deterministic() {
        let a = sample();
        let b = sample();
        assert_eq!(a.claim_id(), b.claim_id());
    }

    #[test]
    fn claim_id_independent_of_evidence_order() {
        let mut reordered = sample();
        reordered.evidence.reverse();
        assert_eq!(sample().claim_id(), reordered.claim_id());
    }

    #[test]
    fn claim_id_changes_with_content() {
        let a = sample();
        let mut b = sample();
        b.observed_value = Some(44);
        assert_ne!(a.claim_id(), b.claim_id());
    }

    #[test]
    fn claim_id_distinguishes_field_boundaries() {
        // Regression guard for the length-prefixing canon.rs tests
        // directly: two claims whose subject/object would concatenate
        // to the same bytes under naive string joining must still hash
        // differently.
        let a = Claim::new(
            "P", "ab", Some("c".to_string()), 0, 0,
            vec!["e".into()], "rule", "x", "1", None, Polarity::Supports, None,
        ).unwrap();
        let b = Claim::new(
            "P", "a", Some("bc".to_string()), 0, 0,
            vec!["e".into()], "rule", "x", "1", None, Polarity::Supports, None,
        ).unwrap();
        assert_ne!(a.claim_id(), b.claim_id());
    }
}
