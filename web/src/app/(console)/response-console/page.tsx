import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default function ResponseConsolePage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Response Console" description="Proposed actions, blast radius, and autonomous-execution policy" />
      <EmptyState
        icon={ShieldAlert}
        title="No proposed actions pending"
        description="Blast radius must render before any approval control is enabled — this screen won't ship an approve button that isn't provably gated on it. Needs a live response-proposal pipeline first."
        phaseNote="Built in Phase 10 — Watchfloor, Timeline, Response Console"
      />
    </div>
  );
}
