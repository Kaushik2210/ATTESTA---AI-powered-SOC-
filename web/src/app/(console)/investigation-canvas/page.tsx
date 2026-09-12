import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { InvestigationCanvasClient } from "@/components/investigation-canvas/investigation-canvas-client";

export default function InvestigationCanvasPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Investigation Canvas" description="The evidence graph for a selected case" />
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          <InvestigationCanvasClient />
        </Suspense>
      </div>
    </div>
  );
}
