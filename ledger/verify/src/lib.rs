//! Client-side (wasm32-compatible) counterpart to the Go `ledger` package:
//! deterministic CBOR canonicalization, BLAKE3 content addressing, and
//! Merkle inclusion-proof verification. This is what the browser runs to
//! independently verify an evidence hash's inclusion proof, per
//! docs/UI-SPEC.md's Verdict Ledger and Investigation Canvas surfaces.
//!
//! Every algorithm here is an independent re-implementation of its
//! `ledger/*.go` counterpart — see each module's doc comment. `tests/golden.rs`
//! is what actually proves the two agree.

pub mod cbor;
pub mod hash;
pub mod merkle;
