import { Waypoints } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default function InvestigationCanvasPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Investigation Canvas" description="The evidence graph for a selected case" />
      <EmptyState
        icon={Waypoints}
        title="No case selected"
        description="The canvas renders a case's claims as a time-aware entity graph — click a node for context, click an edge for its evidence hash and inclusion proof. Open a case from the Watchfloor to see it."
        phaseNote="Built in Phase 11 — Investigation Canvas, Verdict Ledger, Drift Monitor"
      />
    </div>
  );
}
