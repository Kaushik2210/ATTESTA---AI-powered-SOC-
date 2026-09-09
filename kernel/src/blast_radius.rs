use std::collections::BTreeSet;

/// A proposed response action's scope — docs/ARCHITECTURE.md §4: "how
/// many principals, hosts, and dependent services does this touch; is
/// the target a domain controller, a build server, a CEO's laptop."
#[derive(Debug, Clone)]
pub struct BlastRadiusInput {
    pub action: String,
    pub target_principals: Vec<String>,
    pub target_hosts: Vec<String>,
    pub dependent_services: Vec<String>,
    /// Which of the above targets are tier-0/critical assets (domain
    /// controllers, build servers, etc.) — a set for exact, order-
    /// independent membership testing.
    pub critical_assets: BTreeSet<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum RiskTier {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone)]
pub struct BlastRadius {
    pub principal_count: i64,
    pub host_count: i64,
    pub dependent_service_count: i64,
    pub touches_critical_asset: bool,
    pub risk_tier: RiskTier,
}

/// Evaluates a proposed action's blast radius — pure, deterministic, and
/// (docs/ARCHITECTURE.md §4) run "before proposal": the UI renders this
/// BEFORE an approve control is even enabled, never after.
///
/// Risk tiering is deliberately simple and total: touching any critical
/// asset is always at least High regardless of scope size (a domain
/// controller is dangerous even as the ONLY target), and otherwise tier
/// scales with how many principals/hosts/services are touched. Real
/// policy-tunable thresholds are a natural extension (mirroring
/// PolicyBundle's severity_thresholds) once a real response playbook
/// needs to tune them — not needed to prove this function's own
/// correctness now.
pub fn evaluate_blast_radius(input: &BlastRadiusInput) -> BlastRadius {
    let principal_count = input.target_principals.len() as i64;
    let host_count = input.target_hosts.len() as i64;
    let dependent_service_count = input.dependent_services.len() as i64;

    let touches_critical_asset = input
        .target_principals
        .iter()
        .chain(input.target_hosts.iter())
        .any(|t| input.critical_assets.contains(t));

    let scope = principal_count
        .saturating_add(host_count)
        .saturating_add(dependent_service_count);

    let risk_tier = if touches_critical_asset {
        RiskTier::Critical
    } else if scope > 50 {
        RiskTier::High
    } else if scope > 5 {
        RiskTier::Medium
    } else {
        RiskTier::Low
    };

    BlastRadius {
        principal_count,
        host_count,
        dependent_service_count,
        touches_critical_asset,
        risk_tier,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_critical_target_is_always_critical_tier() {
        let mut critical = BTreeSet::new();
        critical.insert("dc01.corp.local".to_string());
        let input = BlastRadiusInput {
            action: "disable_account".into(),
            target_principals: vec![],
            target_hosts: vec!["dc01.corp.local".into()],
            dependent_services: vec![],
            critical_assets: critical,
        };
        let result = evaluate_blast_radius(&input);
        assert_eq!(result.risk_tier, RiskTier::Critical);
        assert!(result.touches_critical_asset);
    }

    #[test]
    fn large_non_critical_scope_is_high_not_critical() {
        let hosts: Vec<String> = (0..60).map(|i| format!("host-{i}")).collect();
        let input = BlastRadiusInput {
            action: "isolate_host".into(),
            target_principals: vec![],
            target_hosts: hosts,
            dependent_services: vec![],
            critical_assets: BTreeSet::new(),
        };
        let result = evaluate_blast_radius(&input);
        assert_eq!(result.risk_tier, RiskTier::High);
        assert!(!result.touches_critical_asset);
    }

    #[test]
    fn single_ordinary_target_is_low() {
        let input = BlastRadiusInput {
            action: "revoke_sessions".into(),
            target_principals: vec!["user:jdoe".into()],
            target_hosts: vec![],
            dependent_services: vec![],
            critical_assets: BTreeSet::new(),
        };
        let result = evaluate_blast_radius(&input);
        assert_eq!(result.risk_tier, RiskTier::Low);
    }

    #[test]
    fn deterministic_regardless_of_target_list_order() {
        let mut critical = BTreeSet::new();
        critical.insert("dc01".to_string());

        let a = BlastRadiusInput {
            action: "x".into(),
            target_principals: vec!["a".into(), "b".into()],
            target_hosts: vec!["dc01".into()],
            dependent_services: vec![],
            critical_assets: critical.clone(),
        };
        let b = BlastRadiusInput {
            action: "x".into(),
            target_principals: vec!["b".into(), "a".into()],
            target_hosts: vec!["dc01".into()],
            dependent_services: vec![],
            critical_assets: critical,
        };
        let ra = evaluate_blast_radius(&a);
        let rb = evaluate_blast_radius(&b);
        assert_eq!(ra.risk_tier, rb.risk_tier);
        assert_eq!(ra.principal_count, rb.principal_count);
    }
}
