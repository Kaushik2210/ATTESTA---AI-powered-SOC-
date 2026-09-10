import { FileCheck2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default function VerdictLedgerPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Verdict Ledger" description="The append-only manifest log, per tenant" />
      <EmptyState
        icon={FileCheck2}
        title="No sealed manifests yet"
        description="Every closed investigation's signed, hash-chained manifest lands here — including the client-side WASM re-verification that recomputes each verdict hash in the browser. The manifest sealing itself is real (services/adjudicate, Phase 7); this screen needs a live API surface in front of it."
        phaseNote="Built in Phase 11 — Investigation Canvas, Verdict Ledger, Drift Monitor"
      />
    </div>
  );
}
