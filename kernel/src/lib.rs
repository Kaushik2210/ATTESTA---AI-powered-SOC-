//! ATTESTA's Adjudication Kernel — docs/ARCHITECTURE.md §2.8.
//!
//! `adjudicate` is a pure, total function: given the same `(claims,
//! policy, kernel_version)`, it returns a byte-identical `Verdict`,
//! always (invariant I1, CLAUDE.md §2). Concretely, that means:
//!
//! - no clock reads, no randomness, no environment variables, no I/O
//! - `BTreeMap`/`BTreeSet` only — never `HashMap`/`HashSet`, whose
//!   iteration order is randomized per-process in Rust
//! - fixed-point `i64` arithmetic throughout — no floats anywhere
//! - no panics: malformed input (an empty claim set, an unbalanced
//!   policy) produces a well-defined `Verdict` (`Disposition::Incomplete`)
//!   or a `Result::Err`, never an unwind across this crate's boundary
//!
//! See phases/reports/PHASE-05.md for how the determinism-verifier gate
//! (docs/PHASES.md, Phase 5) proves this holds: 10,000 repeated-shuffle
//! runs per fixture, cross-architecture hash comparison (x86-64 vs
//! arm64), and native-vs-wasm32 hash comparison via the fixed scenarios
//! in `fixtures.rs`.
#![deny(warnings)]

pub mod blast_radius;
pub mod canon;
pub mod claim;
pub mod fixtures;
pub mod policy;
pub mod tactic;
pub mod verdict;

pub use blast_radius::{evaluate_blast_radius, BlastRadius, BlastRadiusInput, RiskTier};
pub use claim::{Claim, EmptyEvidenceError, Polarity};
pub use policy::{InvalidPolicyError, PolicyBundle, PredicateWeight};
pub use tactic::Tactic;
pub use verdict::{disposition_for, ContributingClaim, Disposition, Severity, Verdict};

use std::collections::{BTreeMap, BTreeSet};

/// Adjudicates a claim set under a policy bundle. Total function: never
/// panics, regardless of input.
///
/// `kernel_version` is recorded in the returned `Verdict` and
/// participates in `verdict_hash` — a kernel upgrade is a version bump,
/// which produces a distinguishably different verdict rather than
/// silently reinterpreting old claims under new logic (the same
/// "versioned, content-addressed" discipline `docs/ARCHITECTURE.md`
/// applies to policy bundles and evidence mappings alike).
pub fn adjudicate(claims: &[Claim], policy: &PolicyBundle, kernel_version: &str) -> Verdict {
    // Sort by claim_id first, unconditionally — the whole point of this
    // step is that adjudicate's OUTPUT must not depend on the order
    // `claims` happened to arrive in. This is what the determinism gate's
    // "randomized insertion order" requirement is actually testing.
    let mut ordered: Vec<(&Claim, [u8; 32])> = claims.iter().map(|c| (c, c.claim_id())).collect();
    ordered.sort_by(|a, b| a.1.cmp(&b.1));

    let mut tactic_scores: BTreeMap<Tactic, i64> = BTreeMap::new();
    let mut contributing: Vec<ContributingClaim> = Vec::new();
    let mut techniques: BTreeSet<String> = BTreeSet::new();
    let mut usable_claim_count: u64 = 0;

    for (claim, claim_id) in &ordered {
        if claim.evidence.is_empty() {
            // Invariant I2 is enforced upstream at the Claim Gate; a
            // claim violating it here means something has already gone
            // wrong before the kernel — exclude it rather than let it
            // silently influence the verdict, and never panic over it.
            continue;
        }
        let Some(pw) = policy.predicate_weights.get(&claim.predicate) else {
            // An unrecognized predicate contributes nothing. This is not
            // an error: a policy bundle is versioned independently of
            // the rule pack that produced the claim, and a predicate
            // the current policy doesn't price is exactly the kind of
            // thing Retro-Verdict Drift re-evaluates later once policy
            // catches up (Phase 8) — never a reason to fail adjudication
            // now.
            continue;
        };
        usable_claim_count += 1;

        let sign: i64 = match claim.polarity {
            Polarity::Supports => 1,
            Polarity::Refutes => -1,
        };
        let contribution = pw.weight.saturating_mul(sign);
        let entry = tactic_scores.entry(pw.tactic).or_insert(0);
        *entry = entry.saturating_add(contribution);

        contributing.push(ContributingClaim {
            claim_id: *claim_id,
            predicate: claim.predicate.clone(),
            attributed_weight: contribution,
        });
        for t in &pw.techniques {
            techniques.insert(t.clone());
        }
    }

    if usable_claim_count == 0 {
        let mut verdict = Verdict {
            severity: Severity::Info,
            confidence: 0,
            disposition: Disposition::Incomplete,
            attack_techniques: Vec::new(),
            contributing_claims: Vec::new(),
            policy_version: policy.policy_version.clone(),
            kernel_version: kernel_version.to_string(),
            verdict_hash: [0u8; 32],
        };
        verdict.verdict_hash = verdict::compute_verdict_hash(&verdict);
        return verdict;
    }

    let base_total: i64 = tactic_scores.values().fold(0i64, |acc, &v| acc.saturating_add(v));

    // Kill-chain adjacency bonus: BTreeMap iterates its keys in Tactic's
    // declared (kill-chain) order, so consecutive `present` entries are
    // exactly the tactic pairs that are BOTH candidates for adjacency —
    // is_adjacent still confirms they're truly consecutive, not merely
    // consecutive among the present subset.
    let present: Vec<Tactic> = tactic_scores.keys().copied().collect();
    let mut chain_bonus: i64 = 0;
    for pair in present.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        if tactic::is_adjacent(a, b) {
            if let Some(&mult) = policy.chain_multipliers.get(&(a, b)) {
                chain_bonus = chain_bonus.saturating_add(mult);
            }
        }
    }

    let total_score = base_total.saturating_add(chain_bonus);
    let confidence = total_score.clamp(0, 10_000);
    let severity = policy.classify(total_score);
    let disposition = disposition_for(severity);

    contributing.sort_by(|a, b| a.claim_id.cmp(&b.claim_id));
    let attack_techniques: Vec<String> = techniques.into_iter().collect();

    let mut verdict = Verdict {
        severity,
        confidence,
        disposition,
        attack_techniques,
        contributing_claims: contributing,
        policy_version: policy.policy_version.clone(),
        kernel_version: kernel_version.to_string(),
        verdict_hash: [0u8; 32],
    };
    verdict.verdict_hash = verdict::compute_verdict_hash(&verdict);
    verdict
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures::{brute_force_then_cnc_policy, brute_force_then_cnc_scenario};

    #[test]
    fn empty_claims_yields_incomplete_never_a_guess() {
        let policy = brute_force_then_cnc_policy(0);
        let v = adjudicate(&[], &policy, "0.0.0-test");
        assert_eq!(v.disposition, Disposition::Incomplete);
        assert_eq!(v.confidence, 0);
    }

    #[test]
    fn output_independent_of_input_order() {
        let policy = brute_force_then_cnc_policy(0);
        let claims = brute_force_then_cnc_scenario();

        let forward = adjudicate(&claims, &policy, "0.0.0-test");

        let mut shuffled = claims.clone();
        shuffled.reverse();
        let reversed = adjudicate(&shuffled, &policy, "0.0.0-test");

        assert_eq!(forward.verdict_hash, reversed.verdict_hash);
    }

    #[test]
    fn unpriced_indicator_then_priced_indicator_changes_the_verdict() {
        // This IS Retro-Verdict Drift's kernel-level mechanism (Phase 8
        // builds the scheduler around it, not the mechanism itself):
        // the identical claim set, adjudicated under two policy versions
        // that differ only in one predicate's weight, produces two
        // different verdicts -- with no re-ingestion and no re-running
        // inference.
        let claims = brute_force_then_cnc_scenario();

        let before = brute_force_then_cnc_policy(0); // CONNECTED_TO_INDICATOR unpriced
        let after = brute_force_then_cnc_policy(5_000); // ...now matches a threat feed

        let v_before = adjudicate(&claims, &before, "0.0.0-test");
        let v_after = adjudicate(&claims, &after, "0.0.0-test");

        assert_ne!(v_before.verdict_hash, v_after.verdict_hash);
        assert!(v_after.confidence > v_before.confidence);
    }

    #[test]
    fn unknown_predicate_is_excluded_not_an_error() {
        let policy = brute_force_then_cnc_policy(0);
        let claim = Claim::new(
            "SOME_FUTURE_PREDICATE_NOT_YET_PRICED",
            "user:jdoe",
            None,
            0,
            0,
            vec!["blake3:x".into()],
            "rule",
            "x",
            "1",
            None,
            Polarity::Supports,
            None,
        )
        .unwrap();
        let v = adjudicate(&[claim], &policy, "0.0.0-test");
        assert_eq!(v.disposition, Disposition::Incomplete);
    }

    #[test]
    fn refutes_polarity_subtracts() {
        let policy = brute_force_then_cnc_policy(0);
        let mut claims = brute_force_then_cnc_scenario();
        let with_support = adjudicate(&claims, &policy, "0.0.0-test");

        // Flip one SUPPORTS claim to REFUTES and confirm the score drops.
        claims[0].polarity = Polarity::Refutes;
        let with_refute = adjudicate(&claims, &policy, "0.0.0-test");

        assert!(with_refute.confidence < with_support.confidence);
    }
}
