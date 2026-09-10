"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BlastRadius, ResponseAction } from "@/lib/data/types";
import { BlastRadiusPanel } from "./blast-radius-panel";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

async function fetchBlastRadius(actionId: string): Promise<BlastRadius> {
  const res = await fetch(`/api/response-actions/${actionId}/blast-radius`);
  const data = await res.json();
  return data.blastRadius;
}

async function postDecision(actionId: string, status: "approved" | "modified" | "rejected") {
  await fetch(`/api/response-actions/${actionId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

const KIND_LABEL: Record<ResponseAction["kind"], string> = {
  isolate_host: "Isolate host",
  disable_account: "Disable account",
  revoke_session: "Revoke session",
  block_indicator: "Block indicator",
  quarantine_file: "Quarantine file",
};

/** phases/PHASES.md's Phase 10 gate, verbatim: "Blast radius renders
 * before any approval control is enabled -- assert the approve button
 * is disabled until blast radius has loaded." `canApprove` below is the
 * literal implementation of that sentence: it is false for the entire
 * duration of the blast-radius fetch (including a real network round
 * trip, not just a client-side spinner) and only becomes true once
 * `blastRadius` genuinely holds data. There is no code path that
 * enables the button before that -- see eval/ui/triage-flow.mjs for
 * the test that asserts it against the real timing, not a mock.
 */
export function ActionDetail({ action }: { action: ResponseAction }) {
  const queryClient = useQueryClient();
  const { data: blastRadius, isLoading } = useQuery({
    queryKey: ["blast-radius", action.id],
    queryFn: () => fetchBlastRadius(action.id),
  });

  const canApprove = !isLoading && blastRadius !== undefined && action.status === "pending";
  const decided = action.status !== "pending";

  const decide = async (status: "approved" | "modified" | "rejected") => {
    await postDecision(action.id, status);
    queryClient.invalidateQueries({ queryKey: ["response-actions"] });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{KIND_LABEL[action.kind]}</h2>
        <p className="font-mono text-sm text-text-secondary">{action.target}</p>
        <p className="mt-2 text-sm text-text-secondary">{action.rationale}</p>
      </div>

      {isLoading ? (
        <div
          data-testid="blast-radius-loading"
          className="flex items-center gap-2 rounded-md border border-hairline bg-surface-1 p-4 text-sm text-text-tertiary"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Computing blast radius…
        </div>
      ) : blastRadius ? (
        <div data-testid="blast-radius-panel">
          <BlastRadiusPanel blastRadius={blastRadius} />
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button data-testid="approve-button" disabled={!canApprove} onClick={() => decide("approved")}>
          {decided ? "Decided" : "Approve"}
        </Button>
        <Button variant="outline" disabled={!canApprove} onClick={() => decide("modified")}>
          Modify
        </Button>
        <Button variant="outline" disabled={!canApprove} onClick={() => decide("rejected")}>
          Reject
        </Button>
      </div>
    </div>
  );
}
