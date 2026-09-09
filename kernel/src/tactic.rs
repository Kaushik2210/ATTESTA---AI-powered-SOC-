/// ATT&CK-style kill-chain tactics, in kill-chain order. Declaration order
/// IS the derived Ord/PartialOrd implementation for a fieldless enum in
/// Rust, so `InitialAccess < Execution < ... < Impact` falls out for
/// free — that's what makes a BTreeMap<Tactic, _> iterate in kill-chain
/// order, and what `is_adjacent` below relies on.
///
/// Scope note (see phases/reports/PHASE-05.md): a subset of MITRE
/// ATT&CK's full tactic list, matching exactly what the rules shipped in
/// Phases 3-4 produce claims for. Extending this list as later detection
/// families are added does not change adjudicate's algorithm.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(u8)]
pub enum Tactic {
    InitialAccess,
    Execution,
    Persistence,
    PrivilegeEscalation,
    DefenseEvasion,
    CredentialAccess,
    Discovery,
    LateralMovement,
    Collection,
    CommandAndControl,
    Exfiltration,
    Impact,
}

impl Tactic {
    pub const ALL: [Tactic; 12] = [
        Tactic::InitialAccess,
        Tactic::Execution,
        Tactic::Persistence,
        Tactic::PrivilegeEscalation,
        Tactic::DefenseEvasion,
        Tactic::CredentialAccess,
        Tactic::Discovery,
        Tactic::LateralMovement,
        Tactic::Collection,
        Tactic::CommandAndControl,
        Tactic::Exfiltration,
        Tactic::Impact,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Tactic::InitialAccess => "initial-access",
            Tactic::Execution => "execution",
            Tactic::Persistence => "persistence",
            Tactic::PrivilegeEscalation => "privilege-escalation",
            Tactic::DefenseEvasion => "defense-evasion",
            Tactic::CredentialAccess => "credential-access",
            Tactic::Discovery => "discovery",
            Tactic::LateralMovement => "lateral-movement",
            Tactic::Collection => "collection",
            Tactic::CommandAndControl => "command-and-control",
            Tactic::Exfiltration => "exfiltration",
            Tactic::Impact => "impact",
        }
    }

    /// Inverse of `name` — used by src/bin/adjudicate_cli.rs to parse a
    /// policy bundle's JSON. Plain string matching, no serde: this stays
    /// in the core module deliberately, since "what string names this
    /// tactic" is a fact about `Tactic` itself, not about any one
    /// consumer's serialization format.
    pub fn from_name(s: &str) -> Option<Tactic> {
        Tactic::ALL.into_iter().find(|t| t.name() == s)
    }
}

/// Two tactics are "adjacent" for chain-multiplier purposes if they are
/// consecutive in kill-chain order — docs/ARCHITECTURE.md §2.5's example:
/// "a Discovery alert following an Initial-Access alert on the same host
/// binds tighter than two unrelated Discovery alerts" describes exactly
/// this adjacency-based weighting, generalized here to any consecutive
/// tactic pair rather than one hardcoded case.
pub fn is_adjacent(a: Tactic, b: Tactic) -> bool {
    (a as i16 - b as i16).abs() == 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kill_chain_order_matches_declaration() {
        assert!(Tactic::InitialAccess < Tactic::Execution);
        assert!(Tactic::CommandAndControl < Tactic::Exfiltration);
        assert!(Tactic::Exfiltration < Tactic::Impact);
    }

    #[test]
    fn adjacency_is_symmetric_and_exact() {
        assert!(is_adjacent(Tactic::Execution, Tactic::Persistence));
        assert!(is_adjacent(Tactic::Persistence, Tactic::Execution));
        assert!(!is_adjacent(Tactic::InitialAccess, Tactic::Persistence));
        assert!(!is_adjacent(Tactic::InitialAccess, Tactic::InitialAccess));
    }
}
