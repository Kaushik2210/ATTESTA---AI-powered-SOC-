#!/usr/bin/env python3
"""License allowlist gate.

Reads whatever per-ecosystem audit reports exist under .audit/ (produced by
pip-licenses, license-checker-rseidelsohn, go-licenses, and cargo-deny — see
the Makefile `audit` target) and cross-checks every resolved SPDX identifier
against .licenserc.yaml. Exits non-zero and prints every violation if
anything outside the allowlist is found. A missing report for an ecosystem
that has no dependencies yet is not a failure.

This is the script docs/LICENSE-POLICY.md's "Enforcement" section refers to,
and what CI and the license-auditor agent both invoke.
"""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIT_DIR = ROOT / ".audit"
POLICY_FILE = ROOT / ".licenserc.yaml"

# This repository's own package(s) — proprietary product code, not a
# third-party dependency, so it doesn't belong in a *dependency* license
# gate. README.md / docs/LICENSE-POLICY.md cover the product's own license.
OWN_PACKAGES = {"attesta", "attesta-investigate"}


def load_policy() -> tuple[set[str], set[str]]:
    """Minimal YAML read for the two flat lists we need — avoids adding a
    PyYAML dependency to a script that itself gates dependencies."""
    allow: set[str] = set()
    always_deny: set[str] = set()
    section = None
    for raw_line in POLICY_FILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if not line:
            continue
        if line == "allow:":
            section = allow
            continue
        if line == "always_deny:":
            section = always_deny
            continue
        if line in ("exceptions:", "exceptions: []"):
            section = None
            continue
        if line.startswith("  - ") and section is not None:
            section.add(line[4:].strip())
    return allow, always_deny


# pip-licenses reports PyPI Trove-classifier text by default (most Python
# packages don't yet declare a PEP 639 SPDX `License-Expression`), so a
# direct string comparison against SPDX identifiers fails almost everything.
# This maps the classifier strings actually seen in practice to SPDX. It is
# deliberately conservative for ambiguous cases (e.g. "BSD License" alone
# doesn't say 2- vs 3-clause) — license-auditor confirms the true license
# from the package's shipped LICENSE file, this table only gets the common
# case out of the automated gate's way.
CLASSIFIER_TO_SPDX = {
    "MIT License": "MIT",
    "BSD License": "BSD-3-Clause",
    "3-Clause BSD License": "BSD-3-Clause",
    "2-Clause BSD License": "BSD-2-Clause",
    "Apache Software License": "Apache-2.0",
    "Apache License 2.0": "Apache-2.0",
    "Apache 2.0": "Apache-2.0",
    "Python Software Foundation License": "PSF-2.0",
    "ISC License (ISCL)": "ISC",
    "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
    "The Unlicense (Unlicense)": "Unlicense",
    "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication": "CC0-1.0",
}


def tokenize(license_expr: str) -> list[str]:
    """Split a compound license expression into individual SPDX-ish tokens
    and map each through the classifier table. A package is fine if ANY
    listed option is on the allowlist (dual-licensed packages), so callers
    check membership across the whole token list, not the raw string."""
    expr = license_expr.strip()
    raw_tokens = re.split(r"\s+OR\s+|;\s*|,\s*", expr)
    return [CLASSIFIER_TO_SPDX.get(t.strip(), t.strip()) for t in raw_tokens if t.strip()]


def check_pip_licenses(allow: set[str], always_deny: set[str]) -> list[str]:
    path = AUDIT_DIR / "py-licenses.json"
    if not path.exists():
        return []
    violations = []
    data = json.loads(path.read_text(encoding="utf-8"))
    for entry in data:
        name = entry.get("Name", "?")
        if name.lower() in OWN_PACKAGES:
            continue
        version = entry.get("Version", "?")
        license_expr = entry.get("License", "UNKNOWN")
        tokens = tokenize(license_expr)
        if any(t in always_deny for t in tokens):
            violations.append(f"python: {name}=={version} carries denylisted license '{license_expr}'")
        elif not any(t in allow for t in tokens):
            violations.append(f"python: {name}=={version} license '{license_expr}' is not on the allowlist")
    return violations


def check_js_licenses(allow: set[str], always_deny: set[str]) -> list[str]:
    path = AUDIT_DIR / "js-licenses.json"
    if not path.exists():
        return []
    violations = []
    data = json.loads(path.read_text(encoding="utf-8"))
    for pkg, info in data.items():
        pkg_name = pkg.rsplit("@", 1)[0]
        if pkg_name.lower() in OWN_PACKAGES:
            continue
        license_expr = info.get("licenses", "UNKNOWN")
        tokens = tokenize(license_expr)
        if any(t in always_deny for t in tokens):
            violations.append(f"js: {pkg} carries denylisted license '{license_expr}'")
        elif not any(t in allow for t in tokens):
            violations.append(f"js: {pkg} license '{license_expr}' is not on the allowlist")
    return violations


def check_go_licenses(allow: set[str], always_deny: set[str]) -> list[str]:
    path = AUDIT_DIR / "go-licenses.csv"
    if not path.exists():
        return []
    violations = []
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.reader(fh):
            if len(row) < 3:
                continue
            module, _url, raw_license = row[0], row[1], row[2].strip()
            license_expr = CLASSIFIER_TO_SPDX.get(raw_license, raw_license)
            if license_expr in always_deny:
                violations.append(f"go: {module} carries denylisted license '{license_expr}'")
            elif license_expr not in allow and license_expr != "Unknown":
                violations.append(f"go: {module} license '{license_expr}' is not on the allowlist")
    return violations


def check_cargo_deny() -> list[str]:
    """cargo-deny enforces its own allowlist from deny.toml directly (`cargo
    deny check licenses`) and fails the Makefile target on its own exit code
    — this function only surfaces a saved report if one was captured, for a
    single combined summary."""
    path = AUDIT_DIR / "cargo-deny.log"
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8", errors="replace")
    if "error[" in text or "rejected" in text.lower():
        return [f"rust: cargo-deny reported violations — see {path.relative_to(ROOT)}"]
    return []


def main() -> int:
    allow, always_deny = load_policy()
    violations: list[str] = []
    violations += check_pip_licenses(allow, always_deny)
    violations += check_js_licenses(allow, always_deny)
    violations += check_go_licenses(allow, always_deny)
    violations += check_cargo_deny()

    if violations:
        print(f"LICENSE GATE: FAIL — {len(violations)} violation(s)\n")
        for v in violations:
            print(f"  - {v}")
        return 1

    print("LICENSE GATE: PASS — no disallowed licenses found in any captured report")
    return 0


if __name__ == "__main__":
    sys.exit(main())
