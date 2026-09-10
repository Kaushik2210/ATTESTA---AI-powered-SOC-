"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ResponseAction } from "@/lib/data/types";
import { ActionList } from "./action-list";
import { ActionDetail } from "./action-detail";
import { AutonomyPolicy } from "./autonomy-policy";
import { EmptyState } from "@/components/empty-state";
import { ShieldAlert } from "lucide-react";

async function fetchActions(): Promise<ResponseAction[]> {
  const res = await fetch("/api/response-actions");
  const data = await res.json();
  return data.actions;
}

export function ResponseConsoleClient() {
  const { data: actions } = useQuery({ queryKey: ["response-actions"], queryFn: fetchActions, refetchInterval: 10_000 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = actions ?? [];
  const selected = list.find((a) => a.id === selectedId) ?? list[0] ?? null;

  if (list.length === 0) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="No proposed actions pending"
        description="Blast radius must render before any approval control is enabled -- this screen won't ship an approve button that isn't provably gated on it."
        phaseNote="Waiting for a high/critical case to propose a response"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <ActionList actions={list} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
      {selected && <ActionDetail key={selected.id} action={selected} />}
      <AutonomyPolicy />
    </div>
  );
}
