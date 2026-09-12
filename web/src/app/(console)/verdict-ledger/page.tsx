import { PageHeader } from "@/components/page-header";
import { VerdictLedgerClient } from "@/components/verdict-ledger/verdict-ledger-client";

export default function VerdictLedgerPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Verdict Ledger" description="The append-only manifest log, per tenant" />
      <div className="min-h-0 flex-1">
        <VerdictLedgerClient />
      </div>
    </div>
  );
}
