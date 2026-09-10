"use client";

import { useMemo } from "react";
import { DISPOSITIONS, SEVERITIES, TACTICS } from "@/lib/data/types";
import type { Case, Disposition, Severity, Tactic } from "@/lib/data/types";

export interface FilterState {
  severities: Set<Severity>;
  dispositions: Set<Disposition>;
  tenants: Set<string>;
  tactics: Set<Tactic>;
  unassignedOnly: boolean;
}

export function emptyFilterState(): FilterState {
  return { severities: new Set(), dispositions: new Set(), tenants: new Set(), tactics: new Set(), unassignedOnly: false };
}

export function applyFilters(cases: Case[], filters: FilterState): Case[] {
  return cases.filter((c) => {
    if (filters.severities.size > 0 && !filters.severities.has(c.severity)) return false;
    if (filters.dispositions.size > 0 && !filters.dispositions.has(c.disposition)) return false;
    if (filters.tenants.size > 0 && !filters.tenants.has(c.tenantId)) return false;
    if (filters.tactics.size > 0 && !c.tactics.some((t) => filters.tactics.has(t))) return false;
    if (filters.unassignedOnly && c.assignee !== null) return false;
    return true;
  });
}

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function FilterGroup<T extends string>({
  title,
  options,
  counts,
  selected,
  onToggle,
}: {
  title: string;
  options: readonly T[];
  counts: Map<T, number>;
  selected: Set<T>;
  onToggle: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="px-2 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{title}</h3>
      {options.map((option) => (
        <label
          key={option}
          className="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1 text-sm text-text-secondary hover:bg-hover"
        >
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selected.has(option)}
              onChange={() => onToggle(option)}
              className="size-3.5 accent-accent-attesta"
            />
            <span className="capitalize">{option}</span>
          </span>
          <span className="font-mono text-xs text-text-tertiary">{counts.get(option) ?? 0}</span>
        </label>
      ))}
    </div>
  );
}

/** docs/UI-SPEC.md's Watchfloor: "filter rail (severity, disposition,
 * tenant, ATT&CK tactic, entity type, age, assignee) with counts."
 * Entity-type and age-range filters are scoped out this phase (see
 * phases/reports/PHASE-10.md) -- severity/disposition/tenant/tactic/
 * assignee cover the same "narrow the queue" job with the same
 * with-counts pattern; a filter dimension is additive, not a redesign.
 */
export function FilterRail({
  cases,
  filters,
  onChange,
}: {
  cases: Case[];
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}) {
  // Scanning 10k cases four times over (once per dimension) is real work
  // -- cheap enough for one pass, but not free enough to repeat on every
  // render this component happens to take part in (e.g. a j/k selection
  // change several levels up). Memoized on `cases` so it only re-runs
  // when the case list itself actually changes.
  const { severityCounts, dispositionCounts, tenantCounts, tacticCounts, unassignedCount, tenants } = useMemo(() => {
    const severityCounts = new Map<Severity, number>();
    const dispositionCounts = new Map<Disposition, number>();
    const tenantCounts = new Map<string, number>();
    const tacticCounts = new Map<Tactic, number>();
    let unassignedCount = 0;

    for (const c of cases) {
      severityCounts.set(c.severity, (severityCounts.get(c.severity) ?? 0) + 1);
      dispositionCounts.set(c.disposition, (dispositionCounts.get(c.disposition) ?? 0) + 1);
      tenantCounts.set(c.tenantId, (tenantCounts.get(c.tenantId) ?? 0) + 1);
      for (const t of c.tactics) tacticCounts.set(t, (tacticCounts.get(t) ?? 0) + 1);
      if (c.assignee === null) unassignedCount++;
    }
    return { severityCounts, dispositionCounts, tenantCounts, tacticCounts, unassignedCount, tenants: Array.from(tenantCounts.keys()).sort() };
  }, [cases]);

  return (
    <aside className="flex w-48 shrink-0 flex-col gap-4 overflow-y-auto border-r border-hairline bg-surface-1 p-2">
      <FilterGroup
        title="Severity"
        options={SEVERITIES}
        counts={severityCounts}
        selected={filters.severities}
        onToggle={(v) => onChange({ ...filters, severities: toggle(filters.severities, v) })}
      />
      <FilterGroup
        title="Disposition"
        options={DISPOSITIONS}
        counts={dispositionCounts}
        selected={filters.dispositions}
        onToggle={(v) => onChange({ ...filters, dispositions: toggle(filters.dispositions, v) })}
      />
      <FilterGroup
        title="Tenant"
        options={tenants}
        counts={tenantCounts}
        selected={filters.tenants}
        onToggle={(v) => onChange({ ...filters, tenants: toggle(filters.tenants, v) })}
      />
      <FilterGroup
        title="ATT&CK tactic"
        options={TACTICS}
        counts={tacticCounts}
        selected={filters.tactics}
        onToggle={(v) => onChange({ ...filters, tactics: toggle(filters.tactics, v) })}
      />
      <label className="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1 text-sm text-text-secondary hover:bg-hover">
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filters.unassignedOnly}
            onChange={() => onChange({ ...filters, unassignedOnly: !filters.unassignedOnly })}
            className="size-3.5 accent-accent-attesta"
          />
          Unassigned only
        </span>
        <span className="font-mono text-xs text-text-tertiary">{unassignedCount}</span>
      </label>
    </aside>
  );
}
