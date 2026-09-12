import { PageHeader } from "@/components/page-header";
import { DriftMonitorClient } from "@/components/drift-monitor/drift-monitor-client";

export default function DriftMonitorPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Drift Monitor" description="Cases whose disposition changed on re-adjudication" />
      <DriftMonitorClient />
    </div>
  );
}
