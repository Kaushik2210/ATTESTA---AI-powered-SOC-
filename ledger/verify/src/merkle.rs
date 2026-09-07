//! Independent Rust re-implementation of `ledger/merkle.go`'s tree —
//! same domain-separated leaf/internal/padding scheme, same algorithm.
//! This is the code that runs client-side (compiled to wasm32) to verify
//! an inclusion proof in the browser, per docs/UI-SPEC.md's Verdict Ledger
//! "verify inclusion proof" action.

use crate::hash::EvidenceId;

const DOMAIN_LEAF: u8 = 0x00;
const DOMAIN_INTERNAL: u8 = 0x01;
const DOMAIN_PAD: u8 = 0x02;

fn leaf_hash(id: &EvidenceId) -> [u8; 32] {
    let mut buf = Vec::with_capacity(1 + 32);
    buf.push(DOMAIN_LEAF);
    buf.extend_from_slice(id);
    *blake3::hash(&buf).as_bytes()
}

fn internal_hash(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut buf = Vec::with_capacity(1 + 32 + 32);
    buf.push(DOMAIN_INTERNAL);
    buf.extend_from_slice(left);
    buf.extend_from_slice(right);
    *blake3::hash(&buf).as_bytes()
}

fn pad_hash(index: u64) -> [u8; 32] {
    let mut buf = [0u8; 9];
    buf[0] = DOMAIN_PAD;
    buf[1..9].copy_from_slice(&index.to_be_bytes());
    *blake3::hash(&buf).as_bytes()
}

fn next_power_of_two(n: usize) -> usize {
    let mut p = 1usize;
    while p < n {
        p *= 2;
    }
    p
}

pub struct MerkleTree {
    leaf_count: usize,
    levels: Vec<Vec<[u8; 32]>>,
}

#[derive(Debug)]
pub struct MerkleError(pub String);

impl MerkleTree {
    pub fn build(ids: &[EvidenceId]) -> Result<Self, MerkleError> {
        if ids.is_empty() {
            return Err(MerkleError("cannot seal an empty batch/epoch".into()));
        }
        let n = next_power_of_two(ids.len());
        let mut level: Vec<[u8; 32]> = Vec::with_capacity(n);
        for id in ids {
            level.push(leaf_hash(id));
        }
        for i in ids.len()..n {
            level.push(pad_hash(i as u64));
        }

        let mut levels = vec![level.clone()];
        while level.len() > 1 {
            let mut next = Vec::with_capacity(level.len() / 2);
            for pair in level.chunks(2) {
                next.push(internal_hash(&pair[0], &pair[1]));
            }
            levels.push(next.clone());
            level = next;
        }

        Ok(MerkleTree { leaf_count: ids.len(), levels })
    }

    pub fn root(&self) -> [u8; 32] {
        self.levels[self.levels.len() - 1][0]
    }

    pub fn prove(&self, i: usize) -> Result<InclusionProof, MerkleError> {
        if i >= self.leaf_count {
            return Err(MerkleError("leaf index out of range".into()));
        }
        let mut steps = Vec::with_capacity(self.levels.len() - 1);
        let mut idx = i;
        for level in 0..self.levels.len() - 1 {
            let nodes = &self.levels[level];
            let (hash, is_left) = if idx % 2 == 0 {
                (nodes[idx + 1], false)
            } else {
                (nodes[idx - 1], true)
            };
            steps.push(ProofStep { hash, is_left });
            idx /= 2;
        }
        Ok(InclusionProof { leaf_index: i, steps })
    }
}

#[derive(Debug, Clone)]
pub struct ProofStep {
    pub hash: [u8; 32],
    pub is_left: bool,
}

#[derive(Debug, Clone)]
pub struct InclusionProof {
    pub leaf_index: usize,
    pub steps: Vec<ProofStep>,
}

/// Recomputes the root from a claimed EvidenceId and its proof, and
/// reports whether it matches. Depends only on the EvidenceId (a hash),
/// never on the underlying payload — the property that makes verification
/// redaction-tolerant (docs/ARCHITECTURE.md §2.3).
pub fn verify_inclusion(id: &EvidenceId, proof: &InclusionProof, root: &[u8; 32]) -> bool {
    let mut h = leaf_hash(id);
    for step in &proof.steps {
        h = if step.is_left {
            internal_hash(&step.hash, &h)
        } else {
            internal_hash(&h, &step.hash)
        };
    }
    &h == root
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids_n(n: usize) -> Vec<EvidenceId> {
        (0..n)
            .map(|i| {
                let (id, _) = crate::hash::new_evidence_id(&crate::cbor::Value::Map(vec![(
                    "i".into(),
                    crate::cbor::Value::Int(i as i64),
                )]));
                id
            })
            .collect()
    }

    #[test]
    fn every_leaf_proves_inclusion() {
        for &n in &[1usize, 2, 3, 4, 5, 7, 8, 16, 17, 100] {
            let ids = ids_n(n);
            let tree = MerkleTree::build(&ids).unwrap();
            let root = tree.root();
            for (i, id) in ids.iter().enumerate() {
                let proof = tree.prove(i).unwrap();
                assert!(verify_inclusion(id, &proof, &root), "n={n} leaf={i} failed to verify");
            }
        }
    }

    #[test]
    fn tampered_root_fails() {
        let ids = ids_n(5);
        let tree = MerkleTree::build(&ids).unwrap();
        let proof = tree.prove(0).unwrap();
        let mut root = tree.root();
        root[0] ^= 0xff;
        assert!(!verify_inclusion(&ids[0], &proof, &root));
    }

    #[test]
    fn different_shapes_different_roots() {
        let a = MerkleTree::build(&ids_n(3)).unwrap();
        let b = MerkleTree::build(&ids_n(4)).unwrap();
        assert_ne!(a.root(), b.root());
    }
}
