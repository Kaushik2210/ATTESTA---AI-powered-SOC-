//! Cross-language determinism proof for the Phase 1 gate.
//!
//! Reads the SAME testdata/golden_events.json that ledger/golden_test.go
//! reads, independently canonicalizes and hashes each event in Rust, and
//! asserts the result matches testdata/golden_vectors.json exactly — the
//! file Go's TestGenerateGoldenVectors wrote. Neither side hardcodes an
//! expected value; the two independent implementations agreeing IS the
//! proof. This test therefore depends on the Go test having run first in
//! the same CI job (see .github/workflows/ci.yml's ledger-tests job) —
//! if testdata/golden_vectors.json is missing, that's what this test's
//! failure message says, not a cryptic file-not-found panic.

use attesta_ledger_verify::cbor::Value;
use attesta_ledger_verify::hash::{new_evidence_id, to_hex};
use attesta_ledger_verify::merkle::{verify_inclusion, InclusionProof, MerkleTree, ProofStep};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
struct EventsFixture {
    events: Vec<EventEntry>,
}

#[derive(Deserialize)]
struct EventEntry {
    name: String,
    value: serde_json::Value,
}

#[derive(Deserialize)]
struct VectorsFile {
    vectors: Vec<Vector>,
    merkle: MerkleFixture,
}

#[derive(Deserialize)]
struct Vector {
    name: String,
    canonical_hex: String,
    blake3_hex: String,
}

#[derive(Deserialize)]
struct MerkleFixture {
    root_hex: String,
    #[allow(dead_code)]
    leaf_order: Vec<String>,
    proof_leaf_0: Vec<ProofStepFixture>,
}

#[derive(Deserialize)]
struct ProofStepFixture {
    hash_hex: String,
    is_left: bool,
}

fn repo_root() -> PathBuf {
    // CARGO_MANIFEST_DIR is ledger/verify; the repo root is two levels up.
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(Path::parent)
        .expect("ledger/verify should be nested two levels under the repo root")
        .to_path_buf()
}

fn json_to_canonical(v: &serde_json::Value) -> Value {
    match v {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::String(s) => Value::Text(s.clone()),
        serde_json::Value::Number(n) => {
            let i = n.as_i64().unwrap_or_else(|| {
                panic!("golden fixture number {n} is not a whole i64 — floats are unsupported")
            });
            Value::Int(i)
        }
        serde_json::Value::Array(items) => Value::Array(items.iter().map(json_to_canonical).collect()),
        serde_json::Value::Object(map) => {
            let entries: BTreeMap<String, Value> =
                map.iter().map(|(k, v)| (k.clone(), json_to_canonical(v))).collect();
            Value::Map(entries.into_iter().collect())
        }
    }
}

#[test]
fn rust_matches_go_golden_vectors() {
    let root = repo_root();
    let events_path = root.join("testdata").join("golden_events.json");
    let vectors_path = root.join("testdata").join("golden_vectors.json");

    let events_raw = std::fs::read_to_string(&events_path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", events_path.display()));
    let fixture: EventsFixture = serde_json::from_str(&events_raw).expect("parsing golden_events.json");

    let vectors_raw = std::fs::read_to_string(&vectors_path).unwrap_or_else(|e| {
        panic!(
            "reading {}: {e}\n\nThis file is produced by `go test ./ledger/... -run TestGenerateGoldenVectors` \
             and must run BEFORE this Rust test in CI (see .github/workflows/ci.yml's ledger-tests job).",
            vectors_path.display()
        )
    });
    let expected: VectorsFile = serde_json::from_str(&vectors_raw).expect("parsing golden_vectors.json");

    assert_eq!(
        fixture.events.len(),
        expected.vectors.len(),
        "golden_events.json and golden_vectors.json have a different number of entries"
    );

    let mut ids = Vec::with_capacity(fixture.events.len());
    for (event, want) in fixture.events.iter().zip(expected.vectors.iter()) {
        assert_eq!(event.name, want.name, "event/vector name mismatch — files are out of sync");

        let value = json_to_canonical(&event.value);
        let (id, canonical) = new_evidence_id(&value);

        assert_eq!(
            to_hex(&canonical),
            want.canonical_hex,
            "event {:?}: canonical CBOR bytes differ between Go and Rust",
            event.name
        );
        assert_eq!(
            to_hex(&id),
            want.blake3_hex,
            "event {:?}: BLAKE3 hash differs between Go and Rust",
            event.name
        );

        ids.push(id);
    }

    // Merkle cross-check: build the same tree Go built (over these IDs, in
    // fixture order) and confirm the root and leaf-0 proof match.
    let tree = MerkleTree::build(&ids).expect("building merkle tree");
    assert_eq!(
        to_hex(&tree.root()),
        expected.merkle.root_hex,
        "Merkle root differs between Go and Rust"
    );

    let proof = tree.prove(0).expect("proving leaf 0");
    let want_steps: Vec<ProofStep> = expected
        .merkle
        .proof_leaf_0
        .iter()
        .map(|s: &ProofStepFixture| ProofStep {
            hash: {
                let bytes = attesta_ledger_verify::hash::from_hex(&s.hash_hex).unwrap();
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&bytes);
                arr
            },
            is_left: s.is_left,
        })
        .collect();

    assert_eq!(proof.steps.len(), want_steps.len(), "proof length differs between Go and Rust");
    for (got_step, want_step) in proof.steps.iter().zip(want_steps.iter()) {
        assert_eq!(to_hex(&got_step.hash), to_hex(&want_step.hash));
        assert_eq!(got_step.is_left, want_step.is_left);
    }

    let root_bytes = attesta_ledger_verify::hash::from_hex(&expected.merkle.root_hex).unwrap();
    let mut root_arr = [0u8; 32];
    root_arr.copy_from_slice(&root_bytes);
    let reconstructed_proof = InclusionProof { leaf_index: 0, steps: want_steps };
    assert!(
        verify_inclusion(&ids[0], &reconstructed_proof, &root_arr),
        "Go's own leaf-0 proof, replayed through Rust's verifier, did not verify"
    );
}
