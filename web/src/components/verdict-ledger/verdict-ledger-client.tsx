"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SealedManifest } from "@/lib/data/types";
import { ManifestTable } from "./manifest-table";
import { HashChain } from "./hash-chain";
import { VerificationPanel } from "./verification-panel";
import { EmptyState } from "@/components/empty-state";
import { FileCheck2 } from "lucide-react";

async function fetchManifests(): Promise<{ manifests: SealedManifest[] }> {
  const res = await fetch("/api/ledger/manifests");
  return res.json();
}

export function VerdictLedgerClient() {
  const { data } = useQuery({ queryKey: ["ledger-manifests"], queryFn: fetchManifests });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const manifests = useMemo(() => data?.manifests ?? [], [data]);

  // Select the first manifest once data arrives -- the React-documented
  // "adjusting state when a prop changes" pattern (calling setState
  // directly in the render body, guarded so it only fires once): a
  // plain useEffect here would select-then-repaint one frame later.
  if (!selectedId && manifests.length > 0) {
    setSelectedId(manifests[0].manifest.investigation_id);
  }

  const selected = useMemo(
    () => manifests.find((m) => m.manifest.investigation_id === selectedId) ?? null,
    [manifests, selectedId],
  );

  if (data && manifests.length === 0) {
    return (
      <EmptyState
        icon={FileCheck2}
        title="No sealed manifests yet"
        description="Manifests appear here once investigations close and seal (services/adjudicate, Phase 7)."
        phaseNote="Waiting on sealed investigations"
      />
    );
  }

  if (!data) {
    return <div className="p-4 text-sm text-text-tertiary">Loading ledger…</div>;
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col border-r border-hairline">
        <ManifestTable manifests={manifests} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <div className="w-[28rem] shrink-0 overflow-y-auto">
        {selected ? (
          <div className="flex flex-col gap-3 p-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-text-tertiary">Investigation</div>
              <div className="mt-1 truncate font-mono text-sm text-text-primary">{selected.manifest.investigation_id}</div>
            </div>
            <HashChain sealed={selected} />
            <VerificationPanel key={selected.manifest.investigation_id} sealed={selected} />
          </div>
        ) : (
          <div className="p-4 text-xs text-text-tertiary">Select a manifest to verify it.</div>
        )}
      </div>
    </div>
  );
}
