import { GitCompareArrows } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default function DriftMonitorPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Drift Monitor" description="Cases whose disposition changed on re-adjudication" />
      <EmptyState
        icon={GitCompareArrows}
        title="No drift to show"
        description="Each row names the single claim and policy delta responsible for a re-adjudicated verdict. The sweep that produces these rows is real (services/adjudicate's RVD engine, Phase 8); this screen needs a live API surface and a seeded case history to render against."
        phaseNote="Built in Phase 11 — Investigation Canvas, Verdict Ledger, Drift Monitor"
      />
    </div>
  );
}
