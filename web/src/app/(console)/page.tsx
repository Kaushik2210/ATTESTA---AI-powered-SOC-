import { PageHeader } from "@/components/page-header";
import { WatchfloorClient } from "@/components/watchfloor/watchfloor-client";

export default function WatchfloorPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Watchfloor" description="Live-updating, risk-ranked case queue" />
      <div className="min-h-0 flex-1">
        <WatchfloorClient />
      </div>
    </div>
  );
}
