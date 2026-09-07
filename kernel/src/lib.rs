//! Placeholder for the pure Adjudication Kernel — see `docs/ARCHITECTURE.md` §2.8.
//!
//! This crate is intentionally empty at Phase 0. Its purpose here is to pin
//! the Rust toolchain (`rust-toolchain.toml`) and give `cargo deny` and the
//! SBOM tooling a real workspace member to scan. The real `adjudicate`
//! entry point, invariant I1 (purity), and the determinism proof land in
//! Phase 5 and are gated by the `determinism-verifier` agent.
