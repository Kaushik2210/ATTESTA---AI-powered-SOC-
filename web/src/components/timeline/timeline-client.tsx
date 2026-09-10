"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Activity, Minus, Plus } from "lucide-react";
import type { Case, TimelineEvent } from "@/lib/data/types";
import { TimelineTrack } from "./timeline-track";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

async function fetchTimeline(caseId: string): Promise<{ case: Case; events: TimelineEvent[] }> {
  const res = await fetch(`/api/cases/${caseId}/timeline`);
  return res.json();
}

/** docs/UI-SPEC.md's Timeline Reconstructor. "Linked selection" with the
 * Investigation Canvas is scoped out this phase -- the canvas doesn't
 * exist until Phase 11 (phases/reports/PHASE-10.md) -- but the selection
 * state itself is real and click-driven here, ready for that surface to
 * read once it exists.
 */
export function TimelineClient() {
  const searchParams = useSearchParams();
  const caseId = searchParams.get("case");
  const [compress, setCompress] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["timeline", caseId],
    queryFn: () => fetchTimeline(caseId!),
    enabled: !!caseId,
  });

  if (!caseId) {
    return (
      <EmptyState
        icon={Activity}
        title="No case selected"
        description="Open a case from the Watchfloor (press i on a selected row, or select “Open investigation”) to reconstruct its timeline."
        phaseNote="Select a case to begin"
      />
    );
  }

  if (!data) {
    return <div className="p-4 text-sm text-text-tertiary">Loading timeline…</div>;
  }

  const selectedEvent = data.events.find((e) => e.id === selectedEventId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <div>
          <div className="text-sm font-medium text-text-primary">{data.case.title}</div>
          <div className="font-mono text-xs text-text-tertiary">{data.case.primaryEntity}</div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <input type="checkbox" checked={compress} onChange={() => setCompress((v) => !v)} className="accent-accent-attesta" />
            Compress idle time
          </label>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" onClick={() => setZoom((z) => Math.max(0.25, z / 1.5))} aria-label="Zoom out">
              <Minus className="size-3.5" aria-hidden="true" />
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => setZoom((z) => Math.min(8, z * 1.5))} aria-label="Zoom in">
              <Plus className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <TimelineTrack events={data.events} compress={compress} zoom={zoom} selectedEventId={selectedEventId} onSelect={setSelectedEventId} />
      </div>

      {selectedEvent && (
        <div className="flex items-center justify-between border-t border-hairline bg-surface-1 px-3 py-2 text-xs">
          <div className="flex items-center gap-3">
            <span className="font-mono text-text-primary">{selectedEvent.predicate}</span>
            <span className="text-text-tertiary">{new Date(selectedEvent.atMs).toLocaleString()}</span>
          </div>
          <span className="font-mono text-text-tertiary">claim:{selectedEvent.claimId.slice(0, 12)}…</span>
        </div>
      )}
    </div>
  );
}
