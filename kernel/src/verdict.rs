use crate::canon::{write_i64, write_str, write_str_list};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

impl Severity {
    pub const ALL: [Severity; 5] =
        [Severity::Info, Severity::Low, Severity::Medium, Severity::High, Severity::Critical];

    pub fn name(self) -> &'static str {
        match self {
            Severity::Info => "info",
            Severity::Low => "low",
            Severity::Medium => "medium",
            Severity::High => "high",
            Severity::Critical => "critical",
        }
    }

    /// Inverse of `name` — see Tactic::from_name's doc comment for why
    /// this lives here rather than in a consumer's own module.
    pub fn from_name(s: &str) -> Option<Severity> {
        Severity::ALL.into_iter().find(|sev| sev.name() == s)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum Disposition {
    /// `adjudicate` was given no usable claims — never fabricate a
    /// Benign verdict from an absence of evidence. docs/ARCHITECTURE.md
    /// §2.6: budget exhaustion "yields ... an INCOMPLETE verdict, never
    /// a guess" — the kernel can't observe an investigator's budget
    /// directly, but it enforces the same discipline for its own
    /// input: no claims in, no opinion out.
    Incomplete,
    Benign,
    Suspicious,
    Malicious,
}

impl Disposition {
    pub const ALL: [Disposition; 4] =
        [Disposition::Incomplete, Disposition::Benign, Disposition::Suspicious, Disposition::Malicious];

    pub fn name(self) -> &'static str {
        match self {
            Disposition::Incomplete => "incomplete",
            Disposition::Benign => "benign",
            Disposition::Suspicious => "suspicious",
            Disposition::Malicious => "malicious",
        }
    }

    pub fn from_name(s: &str) -> Option<Disposition> {
        Disposition::ALL.into_iter().find(|d| d.name() == s)
    }
}

/// Severity maps to Disposition by a fixed rule, not a second
/// independently-configured threshold table — two knobs controlling the
/// same underlying judgment would be two places to update in sync and
/// two places for a policy author to disagree with themselves.
pub fn disposition_for(severity: Severity) -> Disposition {
    match severity {
        Severity::Info | Severity::Low => Disposition::Benign,
        Severity::Medium => Disposition::Suspicious,
        Severity::High | Severity::Critical => Disposition::Malicious,
    }
}

/// One claim's contribution to the final score — docs/ARCHITECTURE.md
/// §2.8: "contributing_claims with attributed weights is what makes the
/// UI explanation derived rather than written."
#[derive(Debug, Clone)]
pub struct ContributingClaim {
    pub claim_id: [u8; 32],
    pub predicate: String,
    pub attributed_weight: i64,
}

#[derive(Debug, Clone)]
pub struct Verdict {
    pub severity: Severity,
    /// Fixed-point, clamped to [0, 10_000] (basis points).
    pub confidence: i64,
    pub disposition: Disposition,
    /// Sorted, deduplicated ATT&CK technique IDs.
    pub attack_techniques: Vec<String>,
    /// Sorted by claim_id.
    pub contributing_claims: Vec<ContributingClaim>,
    pub policy_version: String,
    pub kernel_version: String,
    pub verdict_hash: [u8; 32],
}

/// Hashes everything in a Verdict EXCEPT verdict_hash itself (computing a
/// hash of a struct that contains its own hash is circular) — the
/// content address of a verdict, matching the same
/// canonicalize-then-BLAKE3 discipline claim.rs and Phase 1's ledger both
/// use.
pub fn compute_verdict_hash(v: &Verdict) -> [u8; 32] {
    let mut buf = Vec::new();
    buf.push(v.severity as u8);
    write_i64(&mut buf, v.confidence);
    buf.push(v.disposition as u8);
    write_str_list(&mut buf, &v.attack_techniques);

    buf.extend_from_slice(&(v.contributing_claims.len() as u32).to_be_bytes());
    for c in &v.contributing_claims {
        buf.extend_from_slice(&c.claim_id);
        write_str(&mut buf, &c.predicate);
        write_i64(&mut buf, c.attributed_weight);
    }

    write_str(&mut buf, &v.policy_version);
    write_str(&mut buf, &v.kernel_version);

    *blake3::hash(&buf).as_bytes()
}
