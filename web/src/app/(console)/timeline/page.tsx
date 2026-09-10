import { Activity } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default function TimelinePage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Timeline Reconstructor" description="ATT&CK tactics as horizontal bands, linked to the canvas" />
      <EmptyState
        icon={Activity}
        title="No timeline to reconstruct"
        description="A zoomable, scrubbable timeline needs a case's claims positioned by time and tactic band, and a linked selection with the Investigation Canvas — both arrive together."
        phaseNote="Built in Phase 10/11 alongside the Watchfloor and Investigation Canvas"
      />
    </div>
  );
}
