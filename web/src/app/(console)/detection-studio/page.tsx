import { SquareTerminal } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default function DetectionStudioPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Detection Studio" description="CDL rule authoring, test-against-history, versioning" />
      <EmptyState
        icon={SquareTerminal}
        title="No rule open"
        description="The live test-against-history panel compiles a CDL rule to the same SQL the streaming engine uses and shows what it would have fired on. The CDL compiler is real (detect/, Phase 3); this editor surface isn't built yet."
        phaseNote="Not yet scheduled — see phases/PHASES.md"
      />
    </div>
  );
}
