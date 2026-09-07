#!/usr/bin/env python3
"""Regenerates THIRD-PARTY-NOTICES.md from the .audit/ reports plus the
fixed set of attributions docs/LICENSE-POLICY.md requires regardless of
what a scanner finds (MITRE ATT&CK's redistribution notice in particular —
that one is contractual, not dependency-derived, so it's a static entry).

This file is shipped with the product; it is never rendered as UI chrome
(CLAUDE.md §6 — attribution belongs in this file only).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIT_DIR = ROOT / ".audit"
OUT = ROOT / "THIRD-PARTY-NOTICES.md"

STATIC_NOTICES = """\
## MITRE ATT&CK®

© 2026 The MITRE Corporation. This work is reproduced and distributed with
the permission of The MITRE Corporation. ATTESTA's detection coverage is
described as "mapped to MITRE ATT&CK®"; this does not imply MITRE
endorsement or certification of the product.

## Infrastructure components (Phase 0)

| Component | License | Role |
|---|---|---|
| ClickHouse | Apache-2.0 | event lake |
| PostgreSQL | PostgreSQL License | control plane database |
| NATS Server / JetStream | Apache-2.0 | message bus |
| Valkey | BSD-3-Clause | cache / queue |
| SeaweedFS | Apache-2.0 | local-development object storage |
"""


OWN_PACKAGES = {"attesta"}


def collect_entries() -> list[tuple[str, str, str]]:
    entries: list[tuple[str, str, str]] = []

    py = AUDIT_DIR / "py-licenses.json"
    if py.exists():
        for e in json.loads(py.read_text(encoding="utf-8")):
            name = e.get("Name", "?")
            if name.lower() in OWN_PACKAGES:
                continue
            entries.append((name, e.get("Version", "?"), e.get("License", "UNKNOWN")))

    js = AUDIT_DIR / "js-licenses.json"
    if js.exists():
        for pkg, info in json.loads(js.read_text(encoding="utf-8")).items():
            name, _, version = pkg.rpartition("@")
            if (name or pkg).lower() in OWN_PACKAGES:
                continue
            entries.append((name or pkg, version or "?", info.get("licenses", "UNKNOWN")))

    return sorted(set(entries))


def main() -> None:
    entries = collect_entries()
    lines = [
        "# Third-Party Notices",
        "",
        f"_Generated {datetime.now(timezone.utc):%Y-%m-%d} by `scripts/gen_third_party_notices.py`. "
        "Do not edit by hand — regenerate via `make notices` after `make audit`._",
        "",
        STATIC_NOTICES,
        "## Software dependencies",
        "",
    ]
    if entries:
        lines += ["| Package | Version | License |", "|---|---|---|"]
        lines += [f"| {n} | {v} | {lic} |" for n, v, lic in entries]
    else:
        lines.append(
            "_No dependencies recorded yet — this repository is at Phase 0 "
            "(foundation only). This section populates as `.audit/` reports "
            "are produced by `make audit` in later phases._"
        )
    lines.append("")

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(entries)} dependency entries)")


if __name__ == "__main__":
    main()
