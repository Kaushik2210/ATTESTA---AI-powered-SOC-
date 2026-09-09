use crate::tactic::Tactic;
// BTreeMap only, never HashMap, anywhere in this crate — iteration order
// over a HashMap is randomized per-process in Rust, which is exactly the
// kind of hidden nondeterminism the determinism-verifier gate
// (docs/ARCHITECTURE.md §Phase 5) checks for statically.
use std::collections::BTreeMap;

/// How much a predicate contributes when it fires, and which tactic and
/// ATT&CK technique(s) it maps to — docs/ARCHITECTURE.md §2.8: "Each
/// predicate maps to one or more ATT&CK tactics with a weight and a
/// confidence multiplier."
///
/// Scope note: this reference kernel maps each predicate to exactly ONE
/// tactic (not "one or more") — every predicate Phases 3-4 actually
/// ship needs only one, and a real multi-tactic predicate is a
/// straightforward extension (Vec<Tactic> instead of Tactic) that
/// doesn't change adjudicate's algorithm, just its input shape.
#[derive(Debug, Clone)]
pub struct PredicateWeight {
    pub tactic: Tactic,
    /// Fixed-point, basis points (1/100 of a percent — 10_000 = 100%).
    /// No floats anywhere in the kernel (invariant I1).
    pub weight: i64,
    pub techniques: Vec<String>,
}

/// A versioned, content-addressed bundle of everything `adjudicate`
/// needs beyond the claim set itself — docs/ARCHITECTURE.md §2.8's
/// `PolicyBundle`. Two adjudications of the identical claim set under
/// two different policy versions are EXPECTED to differ — that
/// difference, driven entirely by policy content and never by re-running
/// inference, is Retro-Verdict Drift's mechanism (Phase 8), and this
/// bundle's `policy_version` field is what a Verdict's provenance
/// records to make that traceable.
#[derive(Debug, Clone)]
pub struct PolicyBundle {
    pub policy_version: String,
    pub predicate_weights: BTreeMap<String, PredicateWeight>,
    /// Additive bonus applied when both tactics of an adjacent
    /// (kill-chain-consecutive) pair are present in the same case —
    /// docs/ARCHITECTURE.md §2.5's "kill-chain adjacency" weighting.
    /// Keyed by the pair in kill-chain order (earlier, later); looking
    /// up (later, earlier) is the caller's bug, not this map's problem —
    /// adjudicate always queries in canonical order.
    pub chain_multipliers: BTreeMap<(Tactic, Tactic), i64>,
    /// Ascending by threshold: the highest threshold <= a case's total
    /// score determines its Severity. Must be non-empty and strictly
    /// ascending in the tuple's first element — `PolicyBundle::new`
    /// validates this instead of trusting the caller, since adjudicate
    /// itself must never panic on malformed policy input either.
    severity_thresholds: Vec<(i64, crate::verdict::Severity)>,
}

#[derive(Debug)]
pub struct InvalidPolicyError(pub &'static str);

impl PolicyBundle {
    pub fn new(
        policy_version: impl Into<String>,
        predicate_weights: BTreeMap<String, PredicateWeight>,
        chain_multipliers: BTreeMap<(Tactic, Tactic), i64>,
        severity_thresholds: Vec<(i64, crate::verdict::Severity)>,
    ) -> Result<Self, InvalidPolicyError> {
        if severity_thresholds.is_empty() {
            return Err(InvalidPolicyError("severity_thresholds must not be empty"));
        }
        for w in severity_thresholds.windows(2) {
            if w[1].0 <= w[0].0 {
                return Err(InvalidPolicyError("severity_thresholds must be strictly ascending"));
            }
        }
        Ok(PolicyBundle { policy_version: policy_version.into(), predicate_weights, chain_multipliers, severity_thresholds })
    }

    /// Classifies a total score into a Severity by the highest configured
    /// threshold it meets or exceeds, or the lowest tier if it meets
    /// none — total function, no panics, matches every score to some
    /// Severity by construction (validated non-empty above).
    pub fn classify(&self, total_score: i64) -> crate::verdict::Severity {
        let mut result = self.severity_thresholds[0].1;
        for &(threshold, severity) in &self.severity_thresholds {
            if total_score >= threshold {
                result = severity;
            }
        }
        result
    }
}
