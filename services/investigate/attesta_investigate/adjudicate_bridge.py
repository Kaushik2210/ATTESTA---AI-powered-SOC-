"""Bridges to the real Adjudication Kernel via kernel/src/bin/
adjudicate_cli.rs — see that file's doc comment. This is deliberately a
subprocess call, not an embedded FFI binding: the kernel crate stays
completely unaware that Python exists, and this module is the only place
that has to know the CLI's JSON shape.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Optional

from .models import ProposedClaim


class AdjudicationError(RuntimeError):
    pass


def find_kernel_cli(repo_root: Path) -> Path:
    names = ["adjudicate_cli", "adjudicate_cli.exe"]
    profiles = ["release", "debug"]
    for profile in profiles:
        for name in names:
            candidate = repo_root / "target" / profile / name
            if candidate.exists():
                return candidate
    raise FileNotFoundError(
        "adjudicate_cli binary not found under target/{release,debug}/ -- "
        "run `cargo build --manifest-path kernel/Cargo.toml [--release]` first"
    )


def _claim_to_json(claim: ProposedClaim) -> dict[str, Any]:
    return {
        "predicate": claim.predicate,
        "subject": claim.subject,
        "object": claim.object,
        "interval_start_ns": claim.interval_start_ns,
        "interval_end_ns": claim.interval_end_ns,
        "evidence": claim.evidence,
        "extractor_kind": claim.extractor.kind.value,
        "extractor_id": claim.extractor.id,
        "extractor_version": claim.extractor.version,
        "observed_value": claim.observed_value,
        "polarity": claim.polarity.value,
        "hypothesis_ref": claim.hypothesis_ref,
    }


def adjudicate(
    claims: list[ProposedClaim],
    policy: dict[str, Any],
    kernel_version: str,
    kernel_cli_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> dict[str, Any]:
    """Calls the real kernel and returns its Verdict as a dict (severity,
    confidence, disposition, attack_techniques, contributing_claims,
    policy_version, kernel_version, verdict_hash — see
    adjudicate_cli.rs's VerdictOutput).
    """
    if kernel_cli_path is None:
        if repo_root is None:
            raise ValueError("adjudicate requires either kernel_cli_path or repo_root")
        kernel_cli_path = find_kernel_cli(repo_root)

    request = {
        "kernel_version": kernel_version,
        "policy": policy,
        "claims": [_claim_to_json(c) for c in claims],
    }

    proc = subprocess.run(
        [str(kernel_cli_path)],
        input=json.dumps(request),
        capture_output=True,
        text=True,
        timeout=30,
    )

    try:
        output = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise AdjudicationError(
            f"adjudicate_cli produced non-JSON output (exit {proc.returncode}): "
            f"stdout={proc.stdout!r} stderr={proc.stderr!r}"
        ) from e

    if proc.returncode != 0:
        raise AdjudicationError(f"adjudicate_cli rejected the request: {output.get('error', proc.stderr)}")

    return output
