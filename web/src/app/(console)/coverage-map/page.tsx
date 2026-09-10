import { Map } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default function CoverageMapPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Coverage Map" description="ATT&CK matrix heatmap: rule exists, rule fires, telemetry supports it" />
      <EmptyState
        icon={Map}
        title="No coverage data yet"
        description="Distinguishing “we have a rule” from “the rule has ever fired” from “we have telemetry that would let it fire” needs the CDL rule pack's real fire-rate history behind it."
        phaseNote="Not yet scheduled — see phases/PHASES.md"
      />
    </div>
  );
}
