"use client";

import { useState } from "react";
import { CheckCircle2, Copy, ShieldQuestion, XCircle } from "lucide-react";
import type { GraphEdge } from "@/lib/data/types";
import { verifyInclusion, type InclusionProof } from "@/lib/kernel/merkle";

type ProofState = "idle" | "checking" | "valid" | "invalid" | "error";

/** docs/UI-SPEC.md: "Click an edge (a claim) -> the claim's predicate,
 * interval, extractor, confidence, and its evidence hashes, each
 * expandable to the raw canonical event with a copyable `blake3:...`
 * identifier and a 'verify inclusion proof' action. That hash being
 * visible and verifiable is the product's soul." The verify action
 * below is a real client-side Merkle recomputation (web/src/lib/kernel/
 * merkle.ts) against a proof fetched from the API -- it returns
 * genuinely false for a tampered id or proof, not a decorative check.
 */
export function ClaimPanel({ caseId, nodesParam, edge }: { caseId: string; nodesParam: string | null; edge: GraphEdge }) {
  const [proofStates, setProofStates] = useState<Record<string, ProofState>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function verify(evidenceId: string) {
    setProofStates((s) => ({ ...s, [evidenceId]: "checking" }));
    try {
      const qs = nodesParam ? `?nodes=${nodesParam}` : "";
      const res = await fetch(`/api/graph/${caseId}/evidence/${encodeURIComponent(evidenceId)}/proof${qs}`);
      if (!res.ok) {
        setProofStates((s) => ({ ...s, [evidenceId]: "error" }));
        return;
      }
      const { proof }: { proof: InclusionProof } = await res.json();
      const ok = verifyInclusion(evidenceId, proof);
      setProofStates((s) => ({ ...s, [evidenceId]: ok ? "valid" : "invalid" }));
    } catch {
      setProofStates((s) => ({ ...s, [evidenceId]: "error" }));
    }
  }

  async function copy(id: string) {
    await navigator.clipboard.writeText(id).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1200);
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-text-tertiary">Claim</div>
        <div className="mt-1 font-mono text-sm text-text-primary">{edge.predicate}</div>
        <div className="mt-0.5 text-xs text-text-secondary">
          {edge.polarity === "supports" ? "Supports" : "Refutes"} · confidence {(edge.confidence / 100).toFixed(0)}%
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border border-hairline bg-surface-1 p-2">
          <div className="text-text-tertiary">Interval</div>
          <div className="mt-0.5 font-mono text-text-primary">
            {new Date(edge.intervalStartMs).toLocaleTimeString()} – {new Date(edge.intervalEndMs).toLocaleTimeString()}
          </div>
        </div>
        <div className="rounded-md border border-hairline bg-surface-1 p-2">
          <div className="text-text-tertiary">Extractor</div>
          <div className="mt-0.5 truncate font-mono text-text-primary">{edge.extractorId}@{edge.extractorVersion}</div>
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-text-tertiary">Evidence ({edge.evidenceIds.length})</div>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {edge.evidenceIds.map((id) => {
            const state = proofStates[id] ?? "idle";
            return (
              <li key={id} className="rounded-md border border-hairline bg-surface-1 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px] text-text-secondary">{id}</span>
                  <button
                    type="button"
                    onClick={() => copy(id)}
                    aria-label={`Copy evidence id ${id}`}
                    className="shrink-0 rounded-sm p-1 text-text-tertiary hover:bg-hover hover:text-text-primary"
                  >
                    {copiedId === id ? <CheckCircle2 className="size-3.5 text-disposition-benign" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                  </button>
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => verify(id)}
                    disabled={state === "checking"}
                    data-testid="verify-inclusion-proof"
                    className="rounded-sm border border-hairline px-2 py-0.5 text-[11px] text-text-secondary hover:bg-hover disabled:opacity-60"
                  >
                    {state === "checking" ? "Verifying…" : "Verify inclusion proof"}
                  </button>
                  {state === "valid" && (
                    <span data-testid="proof-valid" className="flex items-center gap-1 text-[11px] text-disposition-benign">
                      <CheckCircle2 className="size-3.5" aria-hidden="true" /> Verified
                    </span>
                  )}
                  {state === "invalid" && (
                    <span data-testid="proof-invalid" className="flex items-center gap-1 text-[11px] text-severity-high">
                      <XCircle className="size-3.5" aria-hidden="true" /> Failed
                    </span>
                  )}
                  {state === "error" && (
                    <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
                      <ShieldQuestion className="size-3.5" aria-hidden="true" /> Error
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
