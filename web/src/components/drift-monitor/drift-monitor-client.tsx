"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { GitCompareArrows } from "lucide-react";
import type { VerdictDrift } from "@/lib/data/types";
import { DriftRow } from "./drift-row";
import { EmptyState } from "@/components/empty-state";

async function fetchDrift(): Promise<{ drifts: VerdictDrift[] }> {
  const res = await fetch("/api/drift");
  return res.json();
}

export function DriftMonitorClient() {
  const router = useRouter();
  const { data } = useQuery({ queryKey: ["drift"], queryFn: fetchDrift });

  function reopen(drift: VerdictDrift) {
    // docs/UI-SPEC.md §5: "One-click reopen into a new investigation,
    // carrying the original manifest as parent." Creating a real new
    // investigation record needs a live backend (Phase 12) -- opening
    // the flipped case's evidence graph is the honest, real subset of
    // that action available this phase.
    router.push(`/investigation-canvas?case=${drift.case_id}`);
  }

  if (!data) {
    return <div className="p-4 text-sm text-text-tertiary">Loading drift sweep…</div>;
  }

  if (data.drifts.length === 0) {
    return (
      <EmptyState
        icon={GitCompareArrows}
        title="No drift this sweep"
        description="Every closed case's verdict still matches the current policy -- nothing to reopen."
        phaseNote="RVD sweep found zero flips"
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="drift-list">
      {data.drifts.map((drift) => (
        <DriftRow key={`${drift.case_id}-${drift.new_verdict_hash}`} drift={drift} onReopen={reopen} />
      ))}
    </div>
  );
}
