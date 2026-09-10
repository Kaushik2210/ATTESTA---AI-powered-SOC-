import type { Tactic } from "@/lib/data/types";

/** ATT&CK tactic chips. Deliberately neutral (hairline border, monospace
 * text) rather than a per-tactic color -- docs/UI-SPEC.md rule 4
 * reserves red/amber for severity alone, and generating a 12-color
 * categorical ramp for tactics that hasn't been run through the
 * dataviz skill's CVD validator isn't worth doing for a label that's
 * already legible as plain text (Phase 10 scope note,
 * phases/reports/PHASE-10.md).
 */
export function TacticChips({ tactics, max = 3 }: { tactics: Tactic[]; max?: number }) {
  const shown = tactics.slice(0, max);
  const overflow = tactics.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((t) => (
        <span
          key={t}
          className="rounded-sm border border-hairline bg-surface-2 px-1 py-0.5 font-mono text-[10px] leading-none text-text-secondary"
        >
          {t}
        </span>
      ))}
      {overflow > 0 && <span className="font-mono text-[10px] text-text-tertiary">+{overflow}</span>}
    </div>
  );
}
