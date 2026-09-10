import type { LucideIcon } from "lucide-react";

/**
 * docs/UI-SPEC.md's component quality bar: "Empty states are real: what
 * this screen shows, why it is empty, and the one action that changes
 * it. Never an illustration with 'Nothing here yet!'" Phase 9 scope note
 * (phases/reports/PHASE-09.md): every surface below is a real, honest
 * empty state naming the phase that builds its live content — there is
 * no live action to offer yet without the backend data those later
 * phases (10/11) produce, so `phaseNote` states that plainly instead of
 * a placebo button that would do nothing.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  phaseNote,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  phaseNote: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon className="size-8 text-text-tertiary" aria-hidden="true" />
      <div className="max-w-md">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        <p className="mt-1.5 text-sm text-text-secondary">{description}</p>
      </div>
      <span className="mt-1 rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-xs text-text-tertiary">
        {phaseNote}
      </span>
    </div>
  );
}
