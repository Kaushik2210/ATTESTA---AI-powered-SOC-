import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { TimelineClient } from "@/components/timeline/timeline-client";

export default function TimelinePage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Timeline Reconstructor" description="ATT&CK tactics as horizontal bands, linked to the canvas" />
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          <TimelineClient />
        </Suspense>
      </div>
    </div>
  );
}
