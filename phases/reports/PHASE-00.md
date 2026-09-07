# Phase 0 — Foundation and license enforcement

**Status: gate passed.** See run history below.

## What was built

- Monorepo skeleton matching `docs/ARCHITECTURE.md` §5 (`kernel/`, `ledger/`, `agent/`, `ingest/`, `services/{api,detect,investigate,adjudicate,respond}`, `policy/`, `rules/`, `web/`, `deploy/`, `eval/`), plus `.claude/agents/` for the 10 subagents from the prompt pack.
- Toolchain pinning: `rust-toolchain.toml` (1.98.1), `go.mod` (Go 1.23), `.python-version` (3.12), `.nvmrc` (Node 20).
- License policy encoded as data, not prose, in two places consumed by tooling: `deny.toml` (cargo-deny, Rust) and `.licenserc.yaml` (Python/JS/Go, read by `scripts/check_licenses.py`).
- Added `PSF-2.0` to the allowlist in `docs/LICENSE-POLICY.md` and corrected `CLAUDE.md`'s tech table, which had mislabeled CPython's own runtime license as MIT (it's PSF-2.0 — the MIT label was actually describing the FastAPI/Pydantic/SQLAlchemy frameworks, not the interpreter).
- `scripts/check_licenses.py` — the actual cross-ecosystem allowlist gate. Reads whatever `.audit/*` reports exist (pip-licenses, license-checker-rseidelsohn, go-licenses, cargo-deny's own log) and fails loudly on anything outside `.licenserc.yaml`'s allowlist or inside its denylist. Includes a Trove-classifier → SPDX normalization table, since pip-licenses reports classifier text ("MIT License", "BSD License") by default rather than bare SPDX identifiers.
- `scripts/gen_third_party_notices.py` — regenerates `THIRD-PARTY-NOTICES.md` from the same audit reports, plus the static MITRE ATT&CK redistribution notice `docs/LICENSE-POLICY.md` requires.
- `scripts/check_no_watermarks.py` — attribution-hygiene grep (CLAUDE.md §6), wired as a pre-commit hook and ready to reuse at the UI gates.
- `docker-compose.dev.yml` — ClickHouse 24.8, PostgreSQL 16, NATS 2.10 (JetStream), Valkey 8.0, SeaweedFS 3, matching the Build Plan's proposed pins.
- `.github/workflows/ci.yml` — two jobs: `bootstrap + license/SBOM gate` (the Phase 0 exit gate itself) and `pre-commit hooks`, on every push to `main` and every PR.
- `.pre-commit-config.yaml`, `.gitignore`, `.env.example`, `docs/LICENSE-EXCEPTIONS.md` (empty template), `Makefile` (`bootstrap`, `audit`, `notices`, `dev-up`, `dev-down`).
- Minimal placeholder crates (`kernel/` — Rust, `ledger/` — Go) so the toolchains and audit tooling have something real to build and scan ahead of Phase 1 and Phase 5, rather than exercising the gate against nothing.
- Repository re-platformed onto its own standalone git history — see "Deviation" below.

## Gate: `make bootstrap && make audit` exits 0

Confirmed in CI, not just locally (this machine has no Rust/Go/Docker toolchain installed, so the authoritative run is GitHub Actions, which provisions all four ecosystems):

- Run [`34134733819`](https://github.com/Kaushik2210/ATTESTA---AI-powered-SOC-/actions/runs/34134733819) on `main` — **both jobs green** (`bootstrap + license/SBOM gate` in 2m48s, `pre-commit hooks` in 14s).
- Locally validated the Python and JS audit paths end-to-end in an isolated venv (not the ambient system Python, which was polluted with unrelated global packages and produced 75 false-positive-looking violations before the venv fix) — `LICENSE GATE: PASS`, `THIRD-PARTY-NOTICES.md` regenerated with 16 real dev-tooling entries.

### Adversarial proof: deliberately add a GPL package, prove CI fails

Per the phase's own instruction ("a license gate you have never seen fail is a license gate that does not work"):

1. Branch `scratch/prove-license-gate-fails`, added `Unidecode>=1.3` (GPL-2.0-or-later, verified against PyPI's own classifier metadata beforehand) to `pyproject.toml`'s `dependencies`.
2. Verified locally first — `LICENSE GATE: FAIL`, correctly naming the package and license.
3. Opened [PR #1](https://github.com/Kaushik2210/ATTESTA---AI-powered-SOC-/pull/1) to trigger the real `pull_request` CI path (a raw branch push doesn't trigger this repo's workflow — it's scoped to `main` pushes and PRs by design). CI run [`34135157648`](https://github.com/Kaushik2210/ATTESTA---AI-powered-SOC-/actions/runs/34135157648) failed as required:

   ```
   == audit: allowlist gate ==
   LICENSE GATE: FAIL — 1 violation(s)

     - python: Unidecode==1.4.0 license 'GNU General Public License v2 or later (GPLv2+)' is not on the allowlist
   make: *** [Makefile:44: audit] Error 1
   ##[error]Process completed with exit code 2.
   ```

4. Closed the PR and deleted the branch, both locally and on GitHub.

## Deviations from spec, with justification

1. **Repository re-platformed onto its own git history, not the ambient one.** The working directory (`C:\Users\Kaushik\OneDrive\Desktop\AI-powered SOC`) turned out to be a subdirectory of a pre-existing git repository rooted at the entire Windows user profile (`C:\Users\Kaushik`), tracking unrelated personal files, other projects, and dotfiles (`.ssh/`, browser data, other coursework repos, etc.). Committing ATTESTA there and pushing would have risked exposing unrelated content. Ran `git init` inside the project folder instead, giving ATTESTA a clean, independent repository scoped to exactly its own files, decoupled from the outer repo. The outer repository was not touched, modified, or committed to.
2. **Rust pin bumped from the Build Plan's proposed 1.82.0 to 1.98.1.** The first real CI run showed `cargo-deny` 0.20.2 requires rustc ≥1.88; 1.82.0 (the Build Plan's placeholder pin, chosen before any CI run existed to validate it against) was too old. Confirmed 1.98.1 against the actual current stable channel manifest before pinning.
3. **`kernel/Cargo.toml` carries no `license` field.** The natural choice, `"UNLICENSED"`, is an npm convention and not a valid SPDX license expression — cargo-deny correctly rejected it as unparseable. Since `kernel/` is `publish = false` proprietary product code rather than a third-party dependency, `deny.toml` now sets `[licenses.private] ignore = true` to exempt unpublished workspace members from the SPDX-field requirement, instead of asserting a fake SPDX string on our own code. (This surfaced a second bug on the way: `[licenses.private]` must be declared *after* `[licenses]`'s other keys in TOML, or those keys get scoped into the wrong table — fixed and verified with `tomllib` locally before the fix was pushed.)
4. **CI's audit job installs the project's own dependencies before scanning**, not just the audit tooling. The original workflow only installed `pip-licenses` itself, which would have made the GPL adversarial test above a false pass (nothing to catch — the project's own `pyproject.toml` dependencies were never actually resolved into the environment being scanned). Fixed before running the adversarial test, so the failure recorded above is real.
5. **`.audit/*` reports are not committed** (gitignored) — they're regenerated by `make audit` and uploaded as a CI artifact instead, since they're a function of whatever's currently installed, not source of truth.

## `license-auditor` summary

- **Total dependencies audited:** 16 (Python dev tooling only — `pip-licenses`, `pre-commit`, `mypy`, and their transitive dependencies; zero production dependencies exist yet at Phase 0, and zero JS/Go/Rust third-party dependencies exist yet either).
- **Violations:** 0 on `main`. 1 on the deliberate scratch test (by design — see above).
- **Warnings:** none outstanding.
- **THIRD-PARTY-NOTICES.md:** regenerated, includes the mandatory MITRE ATT&CK notice and the five Phase 0 infrastructure components (ClickHouse, PostgreSQL, NATS, Valkey, SeaweedFS) even though none are Python/JS/Go/Rust packages a scanner would find on its own.

## Not yet done (explicitly out of scope for Phase 0)

`docker-compose.dev.yml` has not been run end-to-end (no Docker available in this environment) — `make dev-up` is written and reviewed but unverified live. This is a real gap, not a hidden one: the Phase 0 gate as written (`make bootstrap && make audit`) does not require it, but Phase 1 (Evidence Ledger) will need ClickHouse and PostgreSQL actually running, so this should be the first thing verified once a machine or CI job with Docker is available.

## Next

Waiting for approval before Phase 1 (Canonicalization and the Evidence Ledger).
