//! Browser-side JSON bridge to the kernel — the exact counterpart of
//! `kernel/src/bin/adjudicate_cli.rs`, but reachable from `WebAssembly`
//! instead of a subprocess's stdin/stdout, for the Verdict Ledger's
//! client-side verification panel (docs/UI-SPEC.md §4: "The browser
//! loads `attesta_kernel.wasm`, fetches the claim set, recomputes the
//! verdict locally, and compares hashes").
//!
//! This crate depends on `attesta-kernel` (the pure kernel) plus
//! `serde`/`serde_json` for JSON marshaling — deliberately a SEPARATE
//! crate rather than adding serde to `kernel/`'s own `lib.rs`, which
//! Phase 6 established stays free of it (see `kernel/Cargo.toml`'s
//! dependency comment). Invariant I1 (kernel purity) is about
//! `kernel/src/lib.rs::adjudicate` itself; this crate never touches that
//! function's logic, only translates JSON bytes at a wasm ABI boundary
//! into the same typed call `adjudicate_cli.rs` already makes natively.
//!
//! No `wasm-bindgen`: `kernel/`'s existing wasm32-unknown-unknown build
//! (Phase 5's determinism gate) already establishes the project's
//! convention of a raw, hand-rolled C-ABI export surface, loaded via
//! `WebAssembly.instantiate` directly (see `kernel/wasm_cross_check.mjs`
//! and `web/src/lib/kernel-wasm.ts`) rather than generated JS glue. This
//! crate's ABI is four exported functions:
//!
//! - `wasm_alloc(len) -> ptr` / `wasm_dealloc(ptr, len)` — the caller
//!   writes UTF-8 request JSON into wasm linear memory at `ptr`.
//! - `wasm_adjudicate(ptr, len) -> u32` — 1 on success (a Verdict was
//!   computed, even an Incomplete one) or an internal parse/validation
//!   failure encoded as `{"error": "..."}` in the result buffer either
//!   way; 0 only if the input bytes are not valid UTF-8 (the one case
//!   that can't even be turned into a JSON error object). The caller
//!   always reads the result buffer to learn which.
//! - `wasm_result_ptr() -> ptr`, `wasm_result_len() -> len` — the UTF-8
//!   JSON response from the most recent `wasm_adjudicate` call.

use attesta_kernel::{adjudicate, Claim, Polarity, PolicyBundle, PredicateWeight, Severity, Tactic};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::BTreeMap;

// ---- JSON request/response shapes -----------------------------------
// Deliberately duplicated from adjudicate_cli.rs rather than shared: the
// CLI's structs are private to that binary target (not part of any
// library's public API), and a JSON bridge's whole job is translating at
// one specific boundary -- two independent, boundary-local translations
// are the same shape as two independent CLI tools, not something that
// needs a shared abstraction.

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
    submitted_claim_ids: Vec<String>,
}

#[derive(Serialize)]
struct ErrorOutput {
    error: String,
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
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

/// Parses a request, runs the real kernel `adjudicate`, and returns the
/// JSON response body (a `VerdictOutput` or an `{"error": "..."}`) as a
/// `String` -- the pure, host-independent core both the wasm ABI below
/// and this crate's own native tests call, kept separate from memory
/// marshaling so that logic is testable without a wasm runtime.
pub fn adjudicate_json(request_json: &str) -> String {
    let request: RequestInput = match serde_json::from_str(request_json) {
        Ok(r) => r,
        Err(e) => return err_json(&format!("parsing input JSON: {e}")),
    };

    let policy = match build_policy(&request.policy) {
        Ok(p) => p,
        Err(e) => return err_json(&format!("building policy: {e}")),
    };

    let mut claims = Vec::with_capacity(request.claims.len());
    for (i, c) in request.claims.iter().enumerate() {
        match build_claim(c) {
            Ok(claim) => claims.push(claim),
            Err(e) => return err_json(&format!("claim {i}: {e}")),
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

    serde_json::to_string(&output).unwrap_or_else(|e| err_json(&format!("serializing output: {e}")))
}

fn err_json(msg: &str) -> String {
    serde_json::to_string(&ErrorOutput { error: msg.to_string() })
        .unwrap_or_else(|_| "{\"error\":\"internal: could not encode error\"}".to_string())
}

// ---- wasm ABI ---------------------------------------------------------

thread_local! {
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Allocates `len` bytes in linear memory and returns a pointer the JS
/// caller writes its request JSON into. The allocation is leaked (not
/// dropped) until a matching `wasm_dealloc` call -- standard practice
/// for a no-wasm-bindgen manual-memory ABI, matching the buffer-ownership
/// discipline this crate's ABI doc comment describes.
#[no_mangle]
pub extern "C" fn wasm_alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Frees a buffer previously returned by `wasm_alloc`. Never call this on
/// the result buffer from `wasm_result_ptr()` -- that one is owned and
/// freed by `RESULT` itself on the next `wasm_adjudicate` call.
#[no_mangle]
pub extern "C" fn wasm_dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        drop(Vec::from_raw_parts(ptr, len, len));
    }
}

/// Reads `len` UTF-8 bytes of request JSON at `ptr`, runs `adjudicate`,
/// and stores the UTF-8 JSON response in `RESULT` for
/// `wasm_result_ptr`/`wasm_result_len` to expose. Returns 1 once a
/// result (success or a well-formed `{"error":...}`) is available, 0
/// only if the input bytes are not valid UTF-8 at all -- the one
/// failure mode that can't itself become a JSON error body.
#[no_mangle]
pub extern "C" fn wasm_adjudicate(ptr: *const u8, len: usize) -> u32 {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let request_json = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => {
            RESULT.with(|r| *r.borrow_mut() = err_json("request bytes are not valid UTF-8").into_bytes());
            return 0;
        }
    };
    let response = adjudicate_json(request_json);
    RESULT.with(|r| *r.borrow_mut() = response.into_bytes());
    1
}

#[no_mangle]
pub extern "C" fn wasm_result_ptr() -> *const u8 {
    RESULT.with(|r| r.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn wasm_result_len() -> usize {
    RESULT.with(|r| r.borrow().len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_request() -> serde_json::Value {
        serde_json::json!({
            "kernel_version": "0.0.0-test",
            "policy": {
                "policy_version": "test-1",
                "predicate_weights": {
                    "AUTH_FAILED_BURST": {"tactic": "credential-access", "weight": 3000, "techniques": ["T1110"]}
                },
                "chain_multipliers": [],
                "severity_thresholds": [[0, "info"], [2000, "medium"], [8000, "critical"]]
            },
            "claims": [{
                "predicate": "AUTH_FAILED_BURST",
                "subject": "user:jdoe",
                "object": null,
                "interval_start_ns": 0,
                "interval_end_ns": 1,
                "evidence": ["blake3:aaaa"],
                "extractor_kind": "rule",
                "extractor_id": "cdl.credential.auth-burst",
                "extractor_version": "1",
                "observed_value": null,
                "polarity": "supports",
                "hypothesis_ref": null
            }]
        })
    }

    #[test]
    fn adjudicates_a_real_claim_set_and_hex_encodes_hashes() {
        let response = adjudicate_json(&sample_request().to_string());
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(parsed["severity"], "medium");
        assert_eq!(parsed["disposition"], "suspicious");
        let hash = parsed["verdict_hash"].as_str().unwrap();
        assert_eq!(hash.len(), 64);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn same_request_is_byte_identical_every_call() {
        let request = sample_request().to_string();
        let a = adjudicate_json(&request);
        let b = adjudicate_json(&request);
        assert_eq!(a, b);
    }

    #[test]
    fn tampering_a_claim_changes_the_hash() {
        let mut tampered = sample_request();
        tampered["claims"][0]["observed_value"] = serde_json::json!(999);
        let original_response = adjudicate_json(&sample_request().to_string());
        let tampered_response = adjudicate_json(&tampered.to_string());
        let original: serde_json::Value = serde_json::from_str(&original_response).unwrap();
        let tampered_out: serde_json::Value = serde_json::from_str(&tampered_response).unwrap();
        assert_ne!(original["verdict_hash"], tampered_out["verdict_hash"]);
    }

    #[test]
    fn malformed_json_yields_an_error_object_not_a_panic() {
        let response = adjudicate_json("not json");
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert!(parsed["error"].is_string());
    }

    #[test]
    fn wasm_abi_round_trip() {
        let request = sample_request().to_string();
        let bytes = request.as_bytes();
        let ptr = wasm_alloc(bytes.len());
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        }
        let ok = wasm_adjudicate(ptr, bytes.len());
        assert_eq!(ok, 1);
        let result_ptr = wasm_result_ptr();
        let result_len = wasm_result_len();
        let result_bytes = unsafe { std::slice::from_raw_parts(result_ptr, result_len) };
        let parsed: serde_json::Value = serde_json::from_slice(result_bytes).unwrap();
        assert_eq!(parsed["disposition"], "suspicious");
        wasm_dealloc(ptr, bytes.len());
    }
}
