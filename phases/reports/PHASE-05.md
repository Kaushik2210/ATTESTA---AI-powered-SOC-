# Phase 5 — the Adjudication Kernel

**Status: gate passed.** This is the patent's central claim, and it's the one phase where "passed after one fix" still means the fix was in the test harness, not the kernel itself — see below.

## What was built

`kernel/` (Rust, workspace member since Phase 0) now implements `adjudicate(claims, policy, kernel_version) -> Verdict`: a pure, total function satisfying invariant I1 (`CLAUDE.md` §2) by construction, not by convention.

- **`claim.rs`** — `Claim`, a reduced form of `docs/ARCHITECTURE.md` §2.7's schema (subject/object as plain strings, not a structured `EntityRef` — nothing in the kernel's own logic needs to parse them). `claim_id()` is `BLAKE3(canonical(self))`, via a purpose-built length-prefixed byte encoder (`canon.rs`) rather than a shared dependency on `ledger/verify`'s CBOR encoder — keeping this crate's own dependency tree minimal, which the determinism gate checks directly. Evidence hashes are sorted before encoding so `claim_id` doesn't depend on the order they were listed in. `Claim::new` rejects empty evidence (invariant I2) via `Result`, never a panic.
- **`policy.rs`** — `PolicyBundle`: per-predicate tactic/weight/technique mappings (`BTreeMap`, never `HashMap`), kill-chain-adjacency bonuses, and severity thresholds, all validated at construction.
- **`tactic.rs`** — a 12-tactic kill-chain ordering where Rust's derived `Ord` on a fieldless enum *is* the kill-chain order, for free — what makes `BTreeMap<Tactic, _>` iterate in kill-chain order and adjacency a one-line check.
- **`lib.rs`** — `adjudicate` itself: sorts claims by `claim_id` unconditionally (so output never depends on input order), accumulates per-tactic scores with `saturating_*` arithmetic throughout (debug-mode overflow checks panic on plain `+`/`*`/`-`; every kernel arithmetic op uses the saturating form instead — audited line by line, not assumed), applies kill-chain-adjacency bonuses, and classifies severity/disposition. An empty or entirely-unrecognized claim set produces `Disposition::Incomplete`, never a fabricated `Benign`.
- **`blast_radius.rs`** — a second pure function evaluating a proposed response action's scope (`docs/ARCHITECTURE.md` §4), before proposal.
- **`fixtures.rs`** — `docs/DETECTION-SPEC.md`'s own 43-failed-logins-to-C2 worked example, reproduced as an actual fixture. Its dedicated test (`unpriced_indicator_then_priced_indicator_changes_the_verdict`) proves **Retro-Verdict Drift's kernel-level mechanism directly**: the identical claim set, adjudicated under two policy versions differing only in `CONNECTED_TO_INDICATOR`'s weight (0 = unpriced, 5000 = "now matches a threat feed"), produces two different verdicts — with no re-ingestion and no re-running inference. Phase 8 builds the scheduler around this; this phase proves the mechanism it schedules is real.

## Scope decision — read this first

- **One tactic per predicate**, not `docs/ARCHITECTURE.md`'s "one or more." Every predicate Phases 3–4 actually shipped needs only one; a real multi-tactic predicate is a straightforward `Vec<Tactic>` extension that doesn't change the algorithm.
- **Chain-adjacency is fixed-kill-chain-order adjacency** (consecutive `Tactic` enum variants), not the more flexible "any two tactics observed in causal sequence within one case" `docs/DETECTION-SPEC.md`'s prose suggests. Under this simplified model, the flagship worked example's own tactics (CredentialAccess → Execution → CommandAndControl) are **not** adjacent, so its chain bonus is zero — the mechanism is still proven correct, just via a separate, deliberately-adjacent fixture (`adjacent_tactics_scenario`), not the flagship one. A more flexible adjacency model is a documented follow-on, not a silent gap.
- **cargo-fuzz was not used.** It needs a nightly toolchain and libFuzzer/sanitizer support this environment can't verify are available, on top of everything else this phase already had to get right without a local compiler. Substituted with a property-based test (`kernel/tests/determinism.rs`): ~5,000 randomly generated, frequently degenerate claim sets and policies (empty strings, `i64::MIN`/`MAX` weights, unknown predicates, negative intervals) run through `adjudicate` wrapped in `catch_unwind`, proving the same "finds no panic" property a coverage-guided fuzzer would target, just without coverage guidance.

## Gate: the determinism proof

Confirmed in CI across every dimension the gate names: [run `34350171033`](https://github.com/Kaushik2210/ATTESTA---AI-powered-SOC-/actions/runs/34350171033).

| Dimension | Result |
|---|---|
| Repeated shuffle (10,000× per fixture, 3 fixtures, Fisher-Yates via a hand-rolled xorshift64* — no `rand` crate dependency) | byte-identical `verdict_hash` every time |
| Debug vs release profile | 19 unit tests + 2 determinism/fuzz integration tests, both profiles, both architectures |
| Native vs `wasm32-unknown-unknown` | **exact match on all 5 fixed scenarios**, both architectures — see below |
| x86_64 (`ubuntu-latest`) vs arm64 (`macos-latest`) | **byte-identical** — `diff` on the two architectures' hash files reports no differences |
| No-panic property test (~5,000 random/degenerate inputs) | zero panics |

### The one real bug this phase found — in the test harness, not the kernel

The first CI run failed native-vs-wasm comparison on 3 of 5 scenarios. The two architectures agreed with each other perfectly on every value, which was the first sign this wasn't a real determinism failure. The actual cause: WebAssembly's `i64` type carries no signedness of its own; Node's WebAssembly/JS `BigInt` integration decodes a wasm `i64` export as a *signed* 64-bit value by convention, while the Rust side returns `u64`. Any hash whose top bit was set came back as a negative `BigInt` in JavaScript — verified directly: `BigInt.asUintN(64, -0x765a836f4b6e3839n)` computes to `0x89a57c90b491c7c7`, exactly the native value CI reported for that scenario. Fixed by reinterpreting the returned value as unsigned (`BigInt.asUintN(64, ...)`) before formatting. The second CI run confirmed all 5 scenarios match exactly, on both architectures.

This is worth stating plainly: **the kernel's own computation was correct on the first try, on every architecture, in every build profile, in both native and WASM.** The only defect anywhere in this phase's determinism proof was in the JavaScript harness written to verify it — a useful reminder that a verification harness is its own piece of software with its own bugs, not a neutral oracle.

## `license-auditor` note

One new Rust dependency: `blake3` (Apache-2.0 OR CC0-1.0, dual-licensed, both on the allowlist) — the same crate `ledger/verify` already uses, so no new license surface, just a second consumer.

## Next

Waiting for approval before Phase 6 (Claim Gate and the Investigator).
