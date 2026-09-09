//! Fixed, hardcoded scenarios used two ways: as ordinary test fixtures
//! (`kernel::tests` in lib.rs) and as the cross-target determinism proof
//! (docs/PHASES.md's Phase 5 gate: "native and WASM ... byte-identical").
//! Building the input entirely from Rust code — no file I/O, no parsing
//! — means the wasm32 build can construct the exact same scenarios with
//! zero serialization code, which is what keeps the WASM export below
//! (`wasm_fixed_scenario_hash_u64`) simple enough to trust: it either
//! runs the identical Rust logic on the identical hardcoded input as the
//! native build, or it doesn't compile.

use crate::claim::{Claim, Polarity};
use crate::policy::{PolicyBundle, PredicateWeight};
use crate::tactic::Tactic;
use crate::verdict::Severity;
use std::collections::BTreeMap;

/// The docs/DETECTION-SPEC.md worked example: 43 failed logins, a
/// success, a PowerShell spawn with an encoded command, and a network
/// connection to an indicator that may or may not be priced yet.
pub fn brute_force_then_cnc_scenario() -> Vec<Claim> {
    vec![
        Claim::new(
            "AUTH_FAILED_BURST",
            "user:jdoe",
            None,
            1_000_000_000,
            1_060_000_000,
            vec!["blake3:auth-fail-1".into()],
            "rule",
            "cdl.credential.auth-burst-then-success",
            "1",
            Some(43),
            Polarity::Supports,
            None,
        )
        .unwrap(),
        Claim::new(
            "AUTH_SUCCEEDED_AFTER_FAILURES",
            "user:jdoe",
            None,
            1_060_000_000,
            1_061_000_000,
            vec!["blake3:auth-succ-1".into()],
            "rule",
            "cdl.credential.auth-burst-then-success",
            "1",
            Some(118),
            Polarity::Supports,
            None,
        )
        .unwrap(),
        Claim::new(
            "INTERPRETER_SPAWNED_BY",
            "host:WIN-CLIENT-04",
            Some("powershell.exe".to_string()),
            1_070_000_000,
            1_070_000_000,
            vec!["blake3:proc-1".into()],
            "rule",
            "cdl.execution.interpreter-spawned",
            "1",
            None,
            Polarity::Supports,
            None,
        )
        .unwrap(),
        Claim::new(
            "ENCODED_COMMAND",
            "host:WIN-CLIENT-04",
            Some("powershell.exe".to_string()),
            1_070_000_000,
            1_070_000_000,
            vec!["blake3:proc-2".into()],
            "rule",
            "cdl.execution.encoded-command",
            "1",
            None,
            Polarity::Supports,
            None,
        )
        .unwrap(),
        Claim::new(
            "INTERPRETER_NETWORK_EGRESS",
            "host:WIN-CLIENT-04",
            Some("45.61.0.12".to_string()),
            1_080_000_000,
            1_080_000_000,
            vec!["blake3:net-1".into()],
            "rule",
            "cdl.c2.interpreter-network-egress",
            "1",
            None,
            Polarity::Supports,
            None,
        )
        .unwrap(),
        Claim::new(
            "CONNECTED_TO_INDICATOR",
            "host:WIN-CLIENT-04",
            Some("45.61.0.12".to_string()),
            1_080_000_000,
            1_080_000_000,
            vec!["blake3:net-1".into()],
            "rule",
            "cdl.c2.connected-to-indicator",
            "1",
            None,
            Polarity::Supports,
            None,
        )
        .unwrap(),
    ]
}

/// `indicator_weight` is the whole point of this fixture: 0 models "the
/// indicator is unpriced/unknown at adjudication time"; a nonzero value
/// models "the same indicator now matches a threat feed" -- the exact
/// scenario docs/DETECTION-SPEC.md's C7 walks through, and Retro-Verdict
/// Drift's kernel-level mechanism (see lib.rs's
/// `unpriced_indicator_then_priced_indicator_changes_the_verdict` test).
pub fn brute_force_then_cnc_policy(indicator_weight: i64) -> PolicyBundle {
    let mut weights: BTreeMap<String, PredicateWeight> = BTreeMap::new();
    weights.insert(
        "AUTH_FAILED_BURST".into(),
        PredicateWeight { tactic: Tactic::CredentialAccess, weight: 2_000, techniques: vec!["T1110.001".into()] },
    );
    weights.insert(
        "AUTH_SUCCEEDED_AFTER_FAILURES".into(),
        PredicateWeight { tactic: Tactic::CredentialAccess, weight: 1_000, techniques: vec!["T1078".into()] },
    );
    weights.insert(
        "INTERPRETER_SPAWNED_BY".into(),
        PredicateWeight { tactic: Tactic::Execution, weight: 1_500, techniques: vec!["T1059.001".into()] },
    );
    weights.insert(
        "ENCODED_COMMAND".into(),
        PredicateWeight { tactic: Tactic::Execution, weight: 1_500, techniques: vec!["T1059.001".into()] },
    );
    weights.insert(
        "INTERPRETER_NETWORK_EGRESS".into(),
        PredicateWeight { tactic: Tactic::CommandAndControl, weight: 2_000, techniques: vec!["T1071.001".into()] },
    );
    weights.insert(
        "CONNECTED_TO_INDICATOR".into(),
        PredicateWeight { tactic: Tactic::CommandAndControl, weight: indicator_weight, techniques: vec!["T1071.001".into()] },
    );

    PolicyBundle::new(
        "policy.v1-test",
        weights,
        BTreeMap::new(), // this scenario's tactics aren't kill-chain-adjacent under the simplified model -- see phases/reports/PHASE-05.md
        vec![
            (0, Severity::Info),
            (2_000, Severity::Low),
            (5_000, Severity::Medium),
            (8_000, Severity::High),
            (12_000, Severity::Critical),
        ],
    )
    .unwrap()
}

/// A minimal policy over two genuinely kill-chain-adjacent tactics
/// (Execution -> Persistence), used to prove the chain-adjacency bonus
/// mechanism itself works — separately from the flagship scenario above,
/// whose tactics aren't adjacent under this crate's simplified model.
pub fn adjacent_tactics_policy(bonus: i64) -> PolicyBundle {
    let mut weights: BTreeMap<String, PredicateWeight> = BTreeMap::new();
    weights.insert(
        "INTERPRETER_SPAWNED_BY".into(),
        PredicateWeight { tactic: Tactic::Execution, weight: 1_000, techniques: vec![] },
    );
    weights.insert(
        "PERSISTENCE_INSTALLED".into(),
        PredicateWeight { tactic: Tactic::Persistence, weight: 1_000, techniques: vec![] },
    );
    let mut chain = BTreeMap::new();
    chain.insert((Tactic::Execution, Tactic::Persistence), bonus);

    PolicyBundle::new(
        "policy.adjacent-test",
        weights,
        chain,
        vec![(0, Severity::Info), (1_000, Severity::Low), (3_000, Severity::Critical)],
    )
    .unwrap()
}

pub fn adjacent_tactics_scenario() -> Vec<Claim> {
    vec![
        Claim::new(
            "INTERPRETER_SPAWNED_BY",
            "host:h1",
            None,
            0,
            0,
            vec!["blake3:e1".into()],
            "rule",
            "x",
            "1",
            None,
            Polarity::Supports,
            None,
        )
        .unwrap(),
        Claim::new(
            "PERSISTENCE_INSTALLED",
            "host:h1",
            None,
            0,
            0,
            vec!["blake3:e2".into()],
            "rule",
            "x",
            "1",
            None,
            Polarity::Supports,
            None,
        )
        .unwrap(),
    ]
}

/// Returns the first 8 bytes of a fixed scenario's verdict_hash as a
/// u64 -- the comparison unit for the native-vs-wasm32 cross-target
/// proof. A u64 prefix (not the full 32 bytes) keeps the WASM export
/// below trivial (a single primitive return value, no linear-memory
/// read-back needed) while remaining an astronomically strong equality
/// check on its own.
pub fn fixed_scenario_hash_u64(index: u32) -> Option<u64> {
    let (claims, policy) = match index {
        0 => (brute_force_then_cnc_scenario(), brute_force_then_cnc_policy(0)),
        1 => (brute_force_then_cnc_scenario(), brute_force_then_cnc_policy(5_000)),
        2 => (Vec::<Claim>::new(), brute_force_then_cnc_policy(0)),
        3 => (adjacent_tactics_scenario(), adjacent_tactics_policy(500)),
        4 => (adjacent_tactics_scenario(), adjacent_tactics_policy(0)),
        _ => return None,
    };
    let verdict = crate::adjudicate(&claims, &policy, "0.0.0-test");
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&verdict.verdict_hash[0..8]);
    Some(u64::from_be_bytes(buf))
}

pub const FIXED_SCENARIO_COUNT: u32 = 5;

/// WASM-exported wrapper. Returns 0 for an out-of-range index rather
/// than trapping — the Node.js comparison harness (see
/// phases/reports/PHASE-05.md) only ever calls this with
/// `0..FIXED_SCENARIO_COUNT`, so this sentinel is unreachable in
/// practice; it exists so the export itself can never panic across the
/// wasm boundary regardless.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn wasm_fixed_scenario_hash_u64(index: u32) -> u64 {
    fixed_scenario_hash_u64(index).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chain_adjacency_bonus_increases_score() {
        let claims = adjacent_tactics_scenario();
        let without_bonus = crate::adjudicate(&claims, &adjacent_tactics_policy(0), "0.0.0-test");
        let with_bonus = crate::adjudicate(&claims, &adjacent_tactics_policy(500), "0.0.0-test");
        assert!(with_bonus.confidence > without_bonus.confidence);
        assert_eq!(with_bonus.confidence - without_bonus.confidence, 500);
    }

    #[test]
    fn all_fixed_scenarios_resolve() {
        for i in 0..FIXED_SCENARIO_COUNT {
            assert!(fixed_scenario_hash_u64(i).is_some(), "scenario {i} should resolve");
        }
        assert!(fixed_scenario_hash_u64(FIXED_SCENARIO_COUNT).is_none());
    }
}
