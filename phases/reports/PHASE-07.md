# Phase 7 — Manifest, transparency log, replay

**Status: gate passed, on the first real CI run** — no fixes needed after push, a first for this project. The reason is structural, not luck: this phase adds almost no new logic to the kernel or ledger's hot path — it wraps already-proven primitives (canonical CBOR, BLAKE3, Ed25519 signing, Merkle inclusion proofs) in one more layer of the same discipline, and the extensive local smoke-testing this phase's Python surface allowed (see below) caught the wiring bugs before they ever reached a CI round-trip.

## What was built

- **`ledger/manifest.go`** — `InvestigationManifest` (docs/ARCHITECTURE.md §2.9): canonicalization, `BLAKE3` hashing, and `Ed25519` signing/verification, hash-chained per tenant via a caller-supplied `PrevManifestHash` — the exact same purity discipline `epoch.go`'s `SealEpoch` already applies to batch/epoch sealing, applied here to a closed investigation's own record instead of an evidence batch.
- **`ledger/cmd/manifest_cli/` and `ledger/cmd/merkle_cli/`** — two new Go JSON bridges, the direct counterpart to `kernel/src/bin/adjudicate_cli.rs`'s pattern: subprocess in, JSON on stdin, JSON on stdout. `manifest_cli` exposes `seal`/`verify`/`canon_hash`; `merkle_cli` exposes `prove`/`verify` over the Merkle inclusion-proof machinery Phase 1 already built. Neither adds a new Go dependency — both use only what `ledger/` already imports.
- **`services/adjudicate/`** (Python, new package `attesta-adjudicate`) — the orchestration layer:
  - `case_record.py` — `build_case_record()`: runs the real kernel over an already-Claim-Gated claim set, computes a content-addressed `claim_set_hash` (canonicalized independently of the kernel's own per-claim `claim_id()`), seals this case's cited evidence into its own Merkle batch for `epoch_root`, and seals the resulting manifest.
  - `store.py` — `ManifestStore`: owns the one piece of mutable state manifest sealing needs — each tenant's chain tip — mirroring the separation `epoch.go` already draws between a pure sealing function and a caller tracking `prev` across calls.
  - `replay.py` — the Replay Executor's two modes:
    - `replay_pin()`: resubmits a *stored* claim set to a brand-new `adjudicate_cli` subprocess and requires the verdict hash to match exactly what was signed at close time.
    - `replay_rederive()`: re-runs claim extraction from scratch against the same evidence (optionally with a different provider) and reports the *semantic* claim-set diff — added/removed/unchanged — plus whether disposition moved.
  - `export_bundle.py` — writes a self-contained bundle (manifest, claim set, policy, evidence inclusion proofs, verdict) and an independent `verify_bundle()` that re-reads only bundle files plus three local binary paths, recomputing the verdict and every inclusion proof from scratch.
- **`kernel/src/bin/adjudicate_cli.rs`** — extended to report `submitted_claim_ids`: every input claim's `claim_id()`, not just the ones that ended up contributing weight to the verdict (`contributing_claims` stays scoped to that). The manifest's `claim_ids[]` needs the full submitted set.
- CI now builds `manifest_cli`/`merkle_cli` alongside `adjudicate_cli` on both architectures, installs and tests `services/adjudicate`, and includes it in the license audit.

## The gate: 1,000 manifests, adversarial replay

`phases/PHASES.md`: *"replay --pin on 1,000 stored manifests returns byte-identical verdicts — this is the central claim of the patent, so the test must be adversarial: rotate the model, upgrade the inference provider, restart every service, and re-run. Still identical."*

`test_replay_pin_is_byte_identical_across_1000_manifests_with_rotated_models` does exactly that, honestly scoped to what this environment can actually exercise:

| Adversarial condition | What the test does |
|---|---|
| Rotate the model / upgrade the inference provider | Each of the 1,000 cases (spread across 3 tenants) records a *different* fake `Inference.provider`/`model_id` in its manifest, cycling through several identities including an explicit "upgraded" variant. `replay --pin` never reads `Inference` at all — proving this isn't a coincidence requires seeing every single one of 1,000 differently-labeled cases still replay identically, which the test does. |
| Restart every service | No long-running services exist in this environment yet to literally restart (Phase 12 is deployment). What `--pin` actually depends on is a single, stateless subprocess with no shared globals or warm state — every one of the 1,000 replay calls spawns a genuinely new OS process, which is the honest proxy available here. A companion test (`test_replay_pin_result_is_stable_across_repeated_replays_of_the_same_case`) replays one case 50 times, each a fresh process, and requires all 50 to agree — the sharpest version of the same property. |

Result, confirmed in CI on both architectures — [run `34384045498`](https://github.com/Kaushik2210/ATTESTA---AI-powered-SOC-/actions/runs/34384045498): **1,000/1,000 replays byte-identical**, x86_64 and arm64 both. 19/19 `services/adjudicate` tests passed on both runners, first try.

## `--rederive` and the export bundle

`replay_rederive()` re-runs claim extraction (via a deterministic scripted provider, same methodological choice as Phase 6's injection-containment tests) and reports a genuine semantic diff — tested for all three cases: no drift, an added claim (a "more thorough" rotated model), and a removed claim (a "more conservative" one).

`export_bundle`/`verify_bundle` prove the "third party with the bundle and no access to your systems can verify the verdict" property concretely: `verify_bundle` never touches the `CaseRecord` object that produced the bundle, reads only files under the bundle directory plus three local binary paths, and one test (`test_bundle_verifies_from_a_completely_fresh_process`) runs it in a literal separate Python subprocess to prove that. Three tamper tests confirm the negative direction: a mutated claim breaks the verdict-hash check, a mutated manifest breaks the signature check, and — the one bug this phase's own review caught in itself (see below) — a self-consistent-but-substituted inclusion proof breaks a dedicated cross-check against the manifest's own `epoch_root`.

## Scope decisions — read this first

- **The WASM verification bundle is native, not `wasm32-unknown-unknown`.** `docs/ARCHITECTURE.md` §2.9 lists "kernel WASM binary" in the export bundle; this phase's bundle instead references the native `adjudicate_cli`. Phase 5 already proved native and WASM execution byte-identical across architectures — what this phase's gate actually needs is that the bundle's *contents* are self-consistent and independently verifiable by any compatible kernel build, which native demonstrates without requiring a browser. Literal in-browser WASM verification with its own UI affordance is Phase 11's explicit deliverable (`docs/ARCHITECTURE.md` §2.8), not duplicated here.
- **A case's `epoch_root` is its own single-batch Merkle seal over its cited evidence**, not a real hourly, cross-tenant epoch spanning a live streaming ingest pipeline (`docs/ARCHITECTURE.md` §2.3) — there is no such pipeline running in this environment yet. What this phase's gate needs — a manifest's `epoch_root` is a real Merkle root a real inclusion proof verifies against, and a tampered proof is detectable — holds regardless of how many cases happen to share a batch. `epoch_id` is a placeholder constant.
- **`IndexSnapshotHash` is carried as a field and left the zero value.** No full-text/vector index over case state exists yet (that's a Phase 9+ UI concern); the field exists now so a real index doesn't require a manifest shape change later.
- **`InferenceMeta.DecodeParams` is string-keyed and string-valued**, not numeric. Decode parameters like temperature are inherently fractional, and this project's canonical CBOR encoding deliberately has no float rule (see `ledger/cbor.go`'s doc comment) precisely to avoid picking an IEEE-754 canonicalization policy. Keeping them as their literal string form for a descriptive metadata field — not something the verdict depends on — sidesteps reopening that question.

## A real gap this phase's own review caught, before CI ever saw it

While writing `verify_bundle`, a genuine correctness gap surfaced under review: the original version checked that each evidence inclusion proof was *internally* self-consistent (it really does recompute to the root it claims) but never checked that root against the *signed manifest's own* `epoch_root`. That gap would have let a bundle carry a self-consistent-but-substituted Merkle proof — a real tree, just not the one the manifest's signature actually vouches for — and still report as verified. Fixed by adding the cross-check, with a dedicated regression test (`test_bundle_verification_fails_when_inclusion_proof_root_disagrees_with_manifest`) built from a proof that is genuinely valid for the real evidence id but sealed into a different batch than the one actually recorded, isolating exactly the property the fix adds from the simpler "proof doesn't verify at all" case already covered elsewhere.

## Verifying Go without a local Go toolchain

Rust and Go both remain CI-only in this environment (no local toolchain for either). For Go specifically, this phase's review leaned harder than prior phases on manual line-by-line tracing of both new CLI programs against their exact request/response shapes. To reduce genuine risk in the much larger *Python* orchestration surface this phase adds (five new modules wiring across two subprocess bridges), the full pipeline — case building, per-tenant chaining, `replay --pin`, `replay --rederive`, export, and verify — was exercised locally against deterministic pure-Python stand-ins for `manifest_cli`/`merkle_cli`/`adjudicate_cli` (monkeypatched at the subprocess boundary, not committed) before ever pushing. That caught real wiring mistakes — a dispatch-order bug in the stand-in itself, not the product code, but exactly the kind of thing a first CI round-trip would otherwise have needed to surface — and gave confidence in the orchestration logic that CI then confirmed end-to-end against the real binaries on the first push.

## `license-auditor` note

No new dependencies in any ecosystem. `ledger/cmd/manifest_cli` and `ledger/cmd/merkle_cli` use only Go stdlib plus `ledger`'s existing `lukechampine.com/blake3` (already allowlisted, Apache-2.0/CC0-1.0). `services/adjudicate/pyproject.toml` depends only on `pydantic` (MIT, already allowlisted) — `scripts/check_licenses.py`'s `OWN_PACKAGES` was extended with `attesta-adjudicate`, the same one-line fix Phase 6 needed for `attesta-investigate`.

## Next

Waiting for approval before Phase 8.
