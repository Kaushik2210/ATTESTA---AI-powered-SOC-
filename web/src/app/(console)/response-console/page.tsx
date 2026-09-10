import { PageHeader } from "@/components/page-header";
import { ResponseConsoleClient } from "@/components/response-console/response-console-client";

export default function ResponseConsolePage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Response Console" description="Proposed actions, blast radius, and autonomous-execution policy" />
      <div className="min-h-0 flex-1">
        <ResponseConsoleClient />
      </div>
    </div>
  );
}
