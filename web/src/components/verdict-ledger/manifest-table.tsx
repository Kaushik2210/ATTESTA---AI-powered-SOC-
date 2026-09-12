"use client";

import type { SealedManifest } from "@/lib/data/types";
import { SeverityLabel } from "@/components/watchfloor/severity-badge";

function relativeAge(ns: number): string {
  const deltaS = Math.max(0, Math.round((Date.now() - ns / 1_000_000) / 1000));
  if (deltaS < 60) return `${deltaS}s`;
  if (deltaS < 3600) return `${Math.round(deltaS / 60)}m`;
  if (deltaS < 86400) return `${Math.round(deltaS / 3600)}h`;
  return `${Math.round(deltaS / 86400)}d`;
}

/** docs/UI-SPEC.md §4: "Table of manifests: investigation, verdict,
 * model, policy version, kernel version, epoch, timestamp, chain
 * position." */
export function ManifestTable({
  manifests,
  selectedId,
  onSelect,
}: {
  manifests: SealedManifest[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    // role="grid" (not plain "table"): aria-selected on a row is only a
    // valid ARIA state under grid/treegrid, and a bare role="table" with
    // role="row" children that have no role="columnheader"/"cell"
    // themselves fails aria-required-children -- the exact issue Phase
    // 10's case-table.tsx hit and fixed the same way (axe-core caught
    // this here too, not by inspection).
    <div className="min-h-0 flex-1 overflow-auto" role="grid" aria-label="Sealed manifests">
      <div className="sticky top-0 flex border-b border-hairline bg-surface-1 px-3 py-1.5 text-[11px] uppercase tracking-wide text-text-tertiary" role="row">
        <div className="w-56 shrink-0" role="columnheader">Investigation</div>
        <div className="w-24 shrink-0" role="columnheader">Verdict</div>
        <div className="w-40 shrink-0" role="columnheader">Model</div>
        <div className="w-28 shrink-0" role="columnheader">Policy</div>
        <div className="w-16 shrink-0" role="columnheader">Epoch</div>
        <div className="w-16 shrink-0" role="columnheader">Age</div>
        <div className="w-16 shrink-0" role="columnheader">Chain</div>
      </div>
      {manifests.map((sealed) => {
        const isSelected = sealed.manifest.investigation_id === selectedId;
        return (
          <div
            key={sealed.manifest.investigation_id}
            role="row"
            aria-selected={isSelected}
            tabIndex={0}
            onClick={() => onSelect(sealed.manifest.investigation_id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(sealed.manifest.investigation_id);
              }
            }}
            className={`flex cursor-pointer items-center border-b border-hairline px-3 py-1.5 text-xs transition-colors duration-fast ${
              isSelected ? "bg-hover" : "hover:bg-hover"
            }`}
          >
            <div className="w-56 shrink-0 truncate font-mono text-text-secondary" role="gridcell">{sealed.manifest.investigation_id}</div>
            <div className="w-24 shrink-0" role="gridcell">
              <SeverityLabel severity={sealed.manifest.verdict_severity} />
            </div>
            <div className="w-40 shrink-0 truncate text-text-secondary" role="gridcell">{sealed.manifest.inference.model_id}</div>
            <div className="w-28 shrink-0 truncate font-mono text-text-tertiary" role="gridcell">{sealed.manifest.policy_version}</div>
            <div className="w-16 shrink-0 font-mono text-text-tertiary" role="gridcell">{sealed.manifest.epoch_id}</div>
            <div className="w-16 shrink-0 font-mono text-text-tertiary" role="gridcell">{relativeAge(sealed.manifest.completed_at_ns)}</div>
            <div className="w-16 shrink-0" role="gridcell">
              {sealed.chainBroken ? (
                <span className="font-mono text-[10px] text-severity-high">broken</span>
              ) : (
                <span className="font-mono text-[10px] text-disposition-benign">ok</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
