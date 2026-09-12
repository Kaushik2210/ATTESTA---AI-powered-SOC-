"use client";

import type { GraphEdge, GraphNode } from "@/lib/data/types";

/** docs/UI-SPEC.md: "Click a node -> right panel with entity profile,
 * prior cases, asset context." `priorCaseCount` is the one piece of
 * "asset context" the synthetic graph actually carries; a real prior-
 * cases list needs a live case index this phase doesn't have (Phase 12).
 */
export function EntityPanel({ node, edges, onSelectEdge }: { node: GraphNode; edges: GraphEdge[]; onSelectEdge: (e: GraphEdge) => void }) {
  const connected = edges.filter((e) => e.fromNodeId === node.id || e.toNodeId === node.id);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-text-tertiary">Entity</div>
        <div className="mt-1 truncate font-mono text-sm text-text-primary">{node.label}</div>
        <div className="mt-0.5 text-xs capitalize text-text-secondary">{node.type}</div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border border-hairline bg-surface-1 p-2">
          <div className="text-text-tertiary">First seen</div>
          <div className="mt-0.5 font-mono text-text-primary">{new Date(node.firstSeenMs).toLocaleString()}</div>
        </div>
        <div className="rounded-md border border-hairline bg-surface-1 p-2">
          <div className="text-text-tertiary">Prior cases</div>
          <div className="mt-0.5 font-mono text-text-primary">{node.priorCaseCount}</div>
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-text-tertiary">Claims ({connected.length})</div>
        <ul className="mt-1.5 flex flex-col gap-1">
          {connected.slice(0, 60).map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onSelectEdge(e)}
                className="w-full truncate rounded-sm border border-hairline bg-surface-1 px-2 py-1 text-left text-xs text-text-secondary hover:bg-hover"
              >
                <span className={e.polarity === "refutes" ? "text-text-tertiary line-through" : "text-text-primary"}>{e.predicate}</span>
                <span className="ml-1 text-text-tertiary">
                  {e.fromNodeId === node.id ? "→" : "←"} {e.fromNodeId === node.id ? e.toNodeId : e.fromNodeId}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
