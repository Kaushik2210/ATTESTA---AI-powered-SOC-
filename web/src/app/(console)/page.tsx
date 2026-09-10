import { LayoutGrid } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default function WatchfloorPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Watchfloor" description="Live-updating, risk-ranked case queue" />
      <EmptyState
        icon={LayoutGrid}
        title="No cases to triage yet"
        description="The Watchfloor shows every open case ranked by risk, with a live event ticker and stat strip. It needs a running detection pipeline and an SSE case feed to have anything to rank."
        phaseNote="Built in Phase 10 — Watchfloor, Timeline, Response Console"
      />
    </div>
  );
}
