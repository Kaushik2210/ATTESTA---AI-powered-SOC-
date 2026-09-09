//! JSON bridge to the kernel — reads a claim set + policy bundle as JSON
//! on stdin, calls the real `adjudicate`, writes the Verdict as JSON on
//! stdout. This is how services/investigate/ (Python) and any other
//! future non-Rust caller reach the kernel, without embedding Rust via
//! FFI/PyO3 and without the kernel crate itself depending on an RPC
//! framework. Exit code 0 + a verdict object means success; exit code 2
//! + an {"error": "..."} object means the input was malformed.
//!
//! serde/serde_json are used ONLY in this file, never in lib.rs — see
//! Cargo.toml's dependency comment and phases/reports/PHASE-06.md.

use attesta_kernel::{adjudicate, Claim, Polarity, PolicyBundle, PredicateWeight, Severity, Tactic};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::process::exit;

#[derive(Deserialize)]
struct ClaimInput {
    predicate: String,
    subject: String,
    object: Option<String>,
    interval_start_ns: i64,
    interval_end_ns: i64,
    evidence: Vec<String>,
    extractor_kind: String,
    extractor_id: String,
    extractor_version: String,
    observed_value: Option<i64>,
    polarity: String,
    hypothesis_ref: Option<String>,
}

#[derive(Deserialize)]
struct PredicateWeightInput {
    tactic: String,
    weight: i64,
    #[serde(default)]
    techniques: Vec<String>,
}

#[derive(Deserialize)]
struct ChainMultiplierInput {
    from: String,
    to: String,
    bonus: i64,
}

/// A [threshold, "severity-name"] JSON array — a plain 2-tuple struct
/// deserializes from a JSON array of matching length via serde's default
/// derive, so this needs no custom Deserialize impl.
#[derive(Deserialize)]
struct SeverityThresholdInput(i64, String);

#[derive(Deserialize)]
struct PolicyInput {
    policy_version: String,
    predicate_weights: BTreeMap<String, PredicateWeightInput>,
    #[serde(default)]
    chain_multipliers: Vec<ChainMultiplierInput>,
    severity_thresholds: Vec<SeverityThresholdInput>,
}

#[derive(Deserialize)]
struct RequestInput {
    kernel_version: String,
    policy: PolicyInput,
    claims: Vec<ClaimInput>,
}

#[derive(Serialize)]
struct ContributingClaimOutput {
    claim_id: String,
    predicate: String,
    attributed_weight: i64,
}

#[derive(Serialize)]
struct VerdictOutput {
    severity: String,
    confidence: i64,
    disposition: String,
    attack_techniques: Vec<String>,
    contributing_claims: Vec<ContributingClaimOutput>,
    policy_version: String,
    kernel_version: String,
    verdict_hash: String,
    /// claim_id() for every claim in the *submitted* set, in submission
    /// order — not just the ones that ended up contributing weight. This
    /// is what services/adjudicate's manifest sealing (Phase 7) records
    /// as `InvestigationManifest.claim_ids[]`; `contributing_claims`
    /// above stays scoped to what the verdict actually used.
    submitted_claim_ids: Vec<String>,
}

#[derive(Serialize)]
struct ErrorOutput {
    error: String,
}

fn main() {
    let mut input = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut input) {
        fail(&format!("reading stdin: {e}"));
    }

    let request: RequestInput = match serde_json::from_str(&input) {
        Ok(r) => r,
        Err(e) => fail(&format!("parsing input JSON: {e}")),
    };

    let policy = match build_policy(&request.policy) {
        Ok(p) => p,
        Err(e) => fail(&format!("building policy: {e}")),
    };

    let mut claims = Vec::with_capacity(request.claims.len());
    for (i, c) in request.claims.iter().enumerate() {
        match build_claim(c) {
            Ok(claim) => claims.push(claim),
            Err(e) => fail(&format!("claim {i}: {e}")),
        }
    }

    let submitted_claim_ids: Vec<String> = claims.iter().map(|c| hex_encode(&c.claim_id())).collect();

    let verdict = adjudicate(&claims, &policy, &request.kernel_version);
    let output = VerdictOutput {
        severity: verdict.severity.name().to_string(),
        confidence: verdict.confidence,
        disposition: verdict.disposition.name().to_string(),
        attack_techniques: verdict.attack_techniques,
        contributing_claims: verdict
            .contributing_claims
            .into_iter()
            .map(|c| ContributingClaimOutput {
                claim_id: hex_encode(&c.claim_id),
                predicate: c.predicate,
                attributed_weight: c.attributed_weight,
            })
            .collect(),
        policy_version: verdict.policy_version,
        kernel_version: verdict.kernel_version,
        verdict_hash: hex_encode(&verdict.verdict_hash),
        submitted_claim_ids,
    };

    let stdout = io::stdout();
    let mut handle = stdout.lock();
    match serde_json::to_writer(&mut handle, &output) {
        Ok(()) => {
            let _ = handle.write_all(b"\n");
        }
        Err(e) => {
            eprintln!("adjudicate_cli: writing output: {e}");
            exit(2);
        }
    }
}

/// Prints an {"error": "..."} object to stdout and exits with code 2.
/// Returns `!` (never) since `std::process::exit` itself is `-> !` —
/// letting every call site use `fail(...)` directly as a match arm's
/// value (coercible to whatever type that arm needs) instead of a
/// statement followed by an `unreachable!()`.
fn fail(msg: &str) -> ! {
    let out = ErrorOutput { error: msg.to_string() };
    if let Ok(s) = serde_json::to_string(&out) {
        println!("{s}");
    }
    exit(2);
}

fn build_policy(input: &PolicyInput) -> Result<PolicyBundle, String> {
    let mut weights = BTreeMap::new();
    for (predicate, pw) in &input.predicate_weights {
        let tactic = Tactic::from_name(&pw.tactic).ok_or_else(|| format!("unknown tactic {:?}", pw.tactic))?;
        weights.insert(
            predicate.clone(),
            PredicateWeight { tactic, weight: pw.weight, techniques: pw.techniques.clone() },
        );
    }

    let mut chain = BTreeMap::new();
    for cm in &input.chain_multipliers {
        let from = Tactic::from_name(&cm.from).ok_or_else(|| format!("unknown tactic {:?}", cm.from))?;
        let to = Tactic::from_name(&cm.to).ok_or_else(|| format!("unknown tactic {:?}", cm.to))?;
        chain.insert((from, to), cm.bonus);
    }

    let mut thresholds = Vec::with_capacity(input.severity_thresholds.len());
    for t in &input.severity_thresholds {
        let sev = Severity::from_name(&t.1).ok_or_else(|| format!("unknown severity {:?}", t.1))?;
        thresholds.push((t.0, sev));
    }

    PolicyBundle::new(input.policy_version.clone(), weights, chain, thresholds).map_err(|e| format!("{e:?}"))
}

fn build_claim(input: &ClaimInput) -> Result<Claim, String> {
    let polarity =
        Polarity::from_name(&input.polarity).ok_or_else(|| format!("unknown polarity {:?}", input.polarity))?;
    Claim::new(
        input.predicate.clone(),
        input.subject.clone(),
        input.object.clone(),
        input.interval_start_ns,
        input.interval_end_ns,
        input.evidence.clone(),
        input.extractor_kind.clone(),
        input.extractor_id.clone(),
        input.extractor_version.clone(),
        input.observed_value,
        polarity,
        input.hypothesis_ref.clone(),
    )
    .map_err(|_| "empty evidence list".to_string())
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}
