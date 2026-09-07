# Phase 1 — Canonicalization and the Evidence Ledger

**Status: gate passed**, on the first fully-compiled CI run. See run history below.

## What was built

### Go — `ledger/` (the authoritative implementation)

- **`cbor.go`** — a hand-written deterministic CBOR encoder implementing RFC 8949's Core Deterministic Encoding Requirements (§4.2.1): shortest-form integers, definite-length arrays/maps, and map keys sorted by the *bytewise lexicographic order of their own encoded bytes* — not the raw string, and not length-first (the older RFC 7049 rule). Written by hand rather than pulling in a third-party CBOR library, so there is no library-version behavior to trust or drift under — the algorithm is fully specified in this repo and hand-verified against known-correct byte sequences in `cbor_test.go`.
- **`hash.go`** — `EvidenceID = BLAKE3(canonical_cbor(event))`, via `lukechampine.com/blake3`.
- **`merkle.go`** — a domain-separated Merkle tree: distinct hash prefixes for leaves (`0x00`), internal nodes (`0x01`), and padding (`0x02`), which is what prevents the classic "duplicate the last node" tree-forgery vulnerability (the same defense RFC 6962/Certificate Transparency uses). Non-power-of-two leaf counts are padded to the next power of two with domain-tagged padding hashes rather than duplicated real content. Inclusion proof generation and verification.
- **`store.go`** — an in-memory, append-only, content-addressed `Store` with `Put`/`Get`/`Redact`/`IsRedacted`. `Redact` deletes a payload while preserving its ID, so every Merkle proof through it stays valid forever — `Get` on a redacted ID returns a distinct `errRedacted`, never confused with "never existed" (`errUnknownEvidenceID`) or silently substituted content. The real ClickHouse/PostgreSQL-backed store (`docs/ARCHITECTURE.md` §2.3) is deferred to whichever later phase first needs to query it — nothing above this type depends on the backend.
- **`epoch.go`** — `SealBatch` (Merkle root over a batch's EvidenceIDs) and `SealEpoch` (Merkle root over batch roots, Ed25519-signed, chained via `ChainHash()` so `epoch_n.prev == hash(epoch_{n-1})`).
- **`golden_test.go`** — computes canonical-CBOR-hex, BLAKE3-hex, and a Merkle root + leaf-0 proof for a fixed fixture (`testdata/golden_events.json`) and writes `testdata/golden_vectors.json`, consumed by the Rust side (below).

### Rust — `ledger/verify/` (the browser-verification counterpart)

An **independent re-implementation** of the same three algorithms (canonical CBOR, BLAKE3 addressing, Merkle build/prove/verify) — not a shared library the two languages both call into. This is what will run client-side, compiled to `wasm32-unknown-unknown`, for the Verdict Ledger's "verify inclusion proof" action (`docs/UI-SPEC.md`).

- **`src/cbor.rs`**, **`src/hash.rs`**, **`src/merkle.rs`** — same algorithms as their Go counterparts, same hand-verified known-vector unit tests.
- **`tests/golden.rs`** — reads the *same* `testdata/golden_events.json`, independently recomputes everything, and asserts an exact match against `testdata/golden_vectors.json` (written by Go's `TestGenerateGoldenVectors` immediately beforehand, in the same CI job). **Neither implementation hardcodes an expected hash value** — the agreement between two independently-written implementations, in two different languages, using two different BLAKE3 libraries, is the actual proof of cross-language determinism. A shared library would only have proven that one implementation is self-consistent.
- Builds clean under `--target wasm32-unknown-unknown --release`, confirming the browser-verification path is viable this early rather than discovering a wasm-incompatibility during Phase 11.

### CI

New `ledger-tests` job in `.github/workflows/ci.yml`, matrixed across `ubuntu-latest` (x86_64) and `macos-latest` (arm64) — real cross-architecture coverage, not emulated — satisfying the gate's "across two machines/architectures" requirement. Each matrix leg runs, in order: `go mod tidy` (generates `go.sum` fresh — no Go toolchain is available in this dev environment to produce one locally, see Deviations), `go test ./ledger/... -run TestGenerateGoldenVectors` (writes the shared fixture), the full `go test ./ledger/...`, `cargo test --manifest-path ledger/verify/Cargo.toml`, and the wasm32 build.

## Gate: `cargo test && go test ./ledger/...` exits 0

Confirmed in CI on the very first push containing this code — no iteration needed on the Go/Rust source itself (some CI plumbing needed one round of fixes; see Deviations). Run [`34137345024`](https://github.com/Kaushik2210/ATTESTA---AI-powered-SOC-/actions/runs/34137345024), all four jobs green:

| Job | Result |
|---|---|
| `bootstrap + license/SBOM gate` | ✓ 3m14s |
| `pre-commit hooks` | ✓ 12s |
| `ledger determinism proof (Go + Rust, ubuntu-latest)` | ✓ 1m18s |
| `ledger determinism proof (Go + Rust, macos-latest)` | ✓ 1m42s |

### Property test — 10,000 randomly generated events × 1,000 encodings each

Ran the **full count** specified by the gate (not a reduced sample) on both architectures:

```
--- PASS: TestCanonicalEncoding_IsDeterministicUnderRepeatedEncoding (28.33s)   # ubuntu-latest, x86_64
--- PASS: TestCanonicalEncoding_IsDeterministicUnderRepeatedEncoding (30.90s)   # macos-latest, arm64
```

Every one of the 10,000 fixed-seed random events produced a byte-identical canonical encoding and `EvidenceID` across all 1,000 repeated encodings, despite Go's map iteration order being deliberately randomized per-process — proving the explicit key-sort in `cbor.go`, not accidental map order, is what makes the output deterministic.

### Inclusion proofs verify for every node

`TestMerkle_EveryLeafProvesInclusion` builds trees over leaf counts `{1, 2, 3, 4, 5, 7, 8, 16, 17, 100}` — covering both power-of-two and padded shapes — and proves + verifies every single leaf. All passed. Tamper tests (`TestMerkle_TamperedProofFailsVerification`, `TestMerkle_TamperedRootFailsVerification`, `TestMerkle_WrongLeafFailsVerification`) confirm verification genuinely fails on a corrupted proof, root, or leaf — not just that the happy path works.

### A redacted node still verifies structurally and reports unavailability

`TestMerkle_RedactionIsStructurallyTolerant`: writes three events, seals them into a tree, redacts the middle one, and confirms — in order — that (1) `Store.Get` on the redacted ID returns `errRedacted`, distinctly from `errUnknownEvidenceID` for an ID that was never written; (2) the Merkle inclusion proof for that same ID **still verifies** against the same root after redaction, because proofs depend only on the hash, never the payload. Passed on both architectures.

### Cross-language determinism

`cargo test`: 7 unit tests (hand-verified CBOR byte vectors, key-ordering, Merkle proofs) + 1 golden-vector integration test, all passed on both architectures — the golden test specifically confirms Rust's independently-computed canonical bytes, BLAKE3 hashes, Merkle root, and inclusion proof for all 5 fixture events match Go's output exactly.

## Deviations from spec, with justification

1. **No Go/Rust toolchain available in this dev environment.** All code was written and manually verified line-by-line against RFC 8949's spec and hand-computed byte sequences (documented as comments in the test files) rather than iteratively compiled locally. It compiled and passed cleanly on the first real CI run — the manual review caught what would otherwise have been compiler errors (see below) before they reached CI.
2. **One real bug caught by manual review before ever reaching CI:** `golden_test.go` originally declared `root := repoRoot(t)` (a `string`) and, later in the same function, `root := tree.Root()` (a `[32]byte`) — an illegal redeclaration in the same scope that `go vet`/the compiler would have rejected. Renamed the first to `rootDir` before committing.
3. **`go.sum` is not committed**, matching Phase 0's treatment of `Cargo.lock` — no local Go toolchain to generate one correctly. `go mod tidy` runs at the start of every CI job that needs it instead, resolving against the module proxy and sumdb fresh each time. Same reasoning, same fix path: commit a real one once a Go toolchain is available locally to produce and review it.
4. **`testdata/golden_vectors.json` is gitignored, not committed** — it's Go-generated output that Rust's test consumes in the same CI job, not source. `testdata/golden_events.json` (the actual fixed input fixture both languages read) *is* committed.
5. **The real ClickHouse/PostgreSQL-backed evidence store is not wired up.** `docs/ARCHITECTURE.md` §2.3 specifies ClickHouse as the event lake; Phase 1's gate text doesn't require it (only the property test does), so `ledger.Store` is an in-memory reference implementation for now. Flagged, not hidden — first thing to revisit once a later phase actually needs to query persisted evidence, and once `docker-compose.dev.yml`'s ClickHouse service (written in Phase 0, still never run end-to-end — no Docker locally) gets its first real workout.

## Not yet done (explicitly out of scope for Phase 1)

- Real persistent storage backend (see deviation 5).
- OCSF normalization / declarative source mappings — that's Phase 2 (Collection and OCSF normalization) by design; Phase 1 only needed *a* canonical value shape to hash, not the full mapping pipeline.
- Wiring `ledger/verify` into an actual WASM bundle loaded by a browser — the crate builds for `wasm32-unknown-unknown` and is proven correct, but nothing consumes it yet (that's Phase 11, Investigation Canvas / Verdict Ledger).

## Next

Waiting for approval before Phase 2 (Collection and OCSF normalization).
