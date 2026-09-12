"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import type { AttributedClaim, VerdictDrift } from "@/lib/data/types";
import { SeverityLabel } from "@/components/watchfloor/severity-badge";
import { Button } from "@/components/ui/button";

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

function AttributionTable({ title, claims }: { title: string; claims: AttributedClaim[] }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[11px] uppercase tracking-wide text-text-tertiary">{title}</div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {claims.map((c) => (
          <li key={c.claim_id} className="flex items-center justify-between gap-2 font-mono text-[11px]">
            <span className="truncate text-text-secondary">{c.predicate}</span>
            <span className={c.attributed_weight >= 0 ? "text-disposition-benign" : "text-severity-high"}>
              {c.attributed_weight >= 0 ? "+" : ""}
              {c.attributed_weight}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** docs/UI-SPEC.md §5: each row shows the original/new verdict, the
 * dates closed and flipped, the single claim + policy delta
 * responsible (rendered as a diff), and a before/after kernel-
 * attribution comparison. Every field here comes straight from a real
 * `VerdictDrift` the kernel produced twice (lib/data/drift.ts) -- this
 * component only lays it out.
 */
export function DriftRow({ drift, onReopen }: { drift: VerdictDrift; onReopen: (drift: VerdictDrift) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-hairline" data-testid="drift-row">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-hover"
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown className="size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" /> : <ChevronRight className="size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />}
        <span className="w-32 shrink-0 truncate font-mono text-text-secondary">{drift.case_id}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <SeverityLabel severity={drift.old_severity} />
          <span className="text-text-tertiary" aria-hidden="true">
            →
          </span>
          <SeverityLabel severity={drift.new_severity} />
        </span>
        <span className="flex-1" />
        <span className="shrink-0 text-text-tertiary">closed {fmtDate(drift.closed_at_ms)}</span>
        <span className="shrink-0 text-text-tertiary">flipped {fmtDate(drift.flipped_at_ms)}</span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-hairline bg-surface-1 px-4 py-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-text-tertiary">Responsible claim &amp; policy delta</div>
            {drift.policy_deltas.map((d) => (
              <p key={d.predicate} className="mt-1 font-mono text-xs text-text-primary">
                Claim <span className="text-accent-attesta">{drift.responsible_claim_ids[0]?.slice(0, 12)}…</span> ({d.predicate}) weight{" "}
                <span className="text-severity-high line-through">{d.old_weight}</span> → <span className="text-disposition-benign">{d.new_weight}</span>
              </p>
            ))}
            <p className="mt-1 text-[11px] text-text-tertiary">
              indicator corpus {drift.indicator_corpus_version} ({drift.indicator_corpus_hash.slice(0, 12)}…)
            </p>
          </div>

          <div className="flex gap-4">
            <AttributionTable title="Before" claims={drift.old_contributing_claims} />
            <AttributionTable title="After" claims={drift.new_contributing_claims} />
          </div>

          <div className="font-mono text-[11px] text-text-tertiary">
            {drift.old_verdict_hash.slice(0, 12)}… → {drift.new_verdict_hash.slice(0, 12)}…
          </div>

          <Button variant="outline" size="sm" className="w-fit" onClick={() => onReopen(drift)} data-testid="reopen-investigation">
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reopen investigation
          </Button>
        </div>
      )}
    </div>
  );
}
