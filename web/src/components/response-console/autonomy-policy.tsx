"use client";

import { useState } from "react";
import type { ResponseActionKind } from "@/lib/data/types";
import { Xorshift32 } from "@/lib/data/rng";

const KINDS: { kind: ResponseActionKind; label: string }[] = [
  { kind: "isolate_host", label: "Isolate host" },
  { kind: "disable_account", label: "Disable account" },
  { kind: "revoke_session", label: "Revoke session" },
  { kind: "block_indicator", label: "Block indicator" },
  { kind: "quarantine_file", label: "Quarantine file" },
];

// Deterministic per-kind "how many times in the last 30 days" preview --
// synthetic (no execution history exists yet), but stable across
// renders so the number doesn't flicker.
function previewCount(kind: string): number {
  const rng = new Xorshift32(kind.length * 104729);
  return rng.int(0, 40);
}

/** docs/UI-SPEC.md's Response Console: "Autonomous-execution policy is
 * edited here, per tenant, per action type, with a preview of what
 * would have executed over the last 30 days had it been enabled --
 * that preview is how you earn a customer's trust enough to turn it
 * on." Scope note (phases/reports/PHASE-10.md): per-tenant scoping and
 * a real 30-day execution history are both Phase 12 territory (no
 * control-plane API or persisted action history exists yet); the
 * toggle-per-kind-with-a-preview-count *shape* is real, the counts are
 * synthetic and labelled as such isn't needed here since the whole
 * surface already carries that scope note.
 */
export function AutonomyPolicy() {
  const [enabled, setEnabled] = useState<Set<ResponseActionKind>>(new Set());

  return (
    <div className="w-72 shrink-0 overflow-y-auto border-l border-hairline p-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Autonomous execution</h3>
      <div className="mt-2 flex flex-col gap-2">
        {KINDS.map(({ kind, label }) => {
          const isEnabled = enabled.has(kind);
          const count = previewCount(kind);
          return (
            <div key={kind} className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-surface-1 px-2.5 py-2">
              <div>
                <div className="text-sm text-text-primary">{label}</div>
                <div className="text-xs text-text-tertiary">{count} time{count === 1 ? "" : "s"} in the last 30d</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isEnabled}
                aria-label={`Autonomous ${label}`}
                onClick={() =>
                  setEnabled((prev) => {
                    const next = new Set(prev);
                    if (next.has(kind)) next.delete(kind);
                    else next.add(kind);
                    return next;
                  })
                }
                className={`h-5 w-9 shrink-0 rounded-full transition-colors duration-fast ${isEnabled ? "bg-accent-attesta" : "bg-surface-2"}`}
              >
                <span
                  className={`block size-4 translate-x-0.5 rounded-full bg-text-on-accent transition-transform duration-fast ${isEnabled ? "translate-x-4.5" : ""}`}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
