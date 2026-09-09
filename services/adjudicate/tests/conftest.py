"""Shared fixtures for services/adjudicate's tests.

Note on the cross-package import: these tests (and attesta_adjudicate
itself) import from attesta_investigate directly. Both packages are
internal to this monorepo, not published, and are always installed
editable into the same environment together in CI
(.github/workflows/ci.yml installs services/investigate before
services/adjudicate) -- so this is a real, working import, not a
speculative one, even though attesta-adjudicate's pyproject.toml doesn't
declare attesta-investigate as a pip dependency (declaring an unpublished
internal package name as a bare dependency would make `pip install`
either fail or, worse, silently resolve to an unrelated PyPI package of
the same name -- a real supply-chain risk this project's license/allowlist
discipline exists to avoid elsewhere).
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from attesta_adjudicate.manifest import find_go_cli

REPO_ROOT = Path(__file__).resolve().parents[3]

# A fixed Ed25519 seed for reproducible test signatures -- never used
# outside tests. A real deployment fetches a per-tenant signing key from a
# KMS (docs/ARCHITECTURE.md 2.3's "per-tenant key"); that integration is a
# deployment concern (Phase 12), not something the sealing primitive
# itself needs to know about.
TEST_SIGNING_KEY_SEED_HEX = "11" * 32


def fake_evidence_id(label: str) -> str:
    """A deterministic, well-formed (64 hex char) evidence id for tests --
    not a real BLAKE3 hash of any real payload, just something shaped like
    one, since merkle_cli only ever treats it as an opaque 32-byte value.
    """
    return "blake3:" + hashlib.sha256(label.encode()).hexdigest()


@pytest.fixture
def kernel_cli_path() -> Path:
    try:
        from attesta_investigate.adjudicate_bridge import find_kernel_cli

        return find_kernel_cli(REPO_ROOT)
    except FileNotFoundError:
        pytest.skip("adjudicate_cli not built -- run `cargo build --manifest-path kernel/Cargo.toml` first")


@pytest.fixture
def manifest_cli_path() -> Path:
    try:
        return find_go_cli(REPO_ROOT, "manifest_cli")
    except FileNotFoundError:
        pytest.skip("manifest_cli not built -- run `go build -o target/release/manifest_cli ./ledger/cmd/manifest_cli` first")


@pytest.fixture
def merkle_cli_path() -> Path:
    try:
        return find_go_cli(REPO_ROOT, "merkle_cli")
    except FileNotFoundError:
        pytest.skip("merkle_cli not built -- run `go build -o target/release/merkle_cli ./ledger/cmd/merkle_cli` first")
