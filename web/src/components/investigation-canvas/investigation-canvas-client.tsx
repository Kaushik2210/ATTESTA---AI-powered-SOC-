"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Play, ZoomIn } from "lucide-react";
import type { GraphEdge, GraphNode } from "@/lib/data/types";
import { GraphCanvas } from "./graph-canvas";
import { EntityPanel } from "./entity-panel";
import { ClaimPanel } from "./claim-panel";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  columnCount: number;
}

async function fetchGraph(caseId: string, nodesParam: string | null): Promise<GraphResponse> {
  const qs = nodesParam ? `?nodes=${nodesParam}` : "";
  const res = await fetch(`/api/graph/${caseId}${qs}`);
  return res.json();
}

/** docs/UI-SPEC.md's Investigation Canvas -- "the centerpiece, and the
 * screen that will sell the product." See phases/reports/PHASE-11.md
 * for the full scope note; in short: the graph, layout, quadtree
 * hit-testing, and evidence-hash verification are all real and tested
 * against a live rendered graph; "replay attack path" traces the
 * investigation's edges in chronological order rather than running a
 * full shortest-path graph search between two chosen endpoints, a
 * deliberate scope trim named honestly rather than left undocumented.
 */
export function InvestigationCanvasClient() {
  const searchParams = useSearchParams();
  const caseId = searchParams.get("case");
  const nodesParam = searchParams.get("nodes");

  const { data } = useQuery({
    queryKey: ["graph", caseId, nodesParam],
    queryFn: () => fetchGraph(caseId!, nodesParam),
    enabled: !!caseId,
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [replayEdgeIds, setReplayEdgeIds] = useState<Set<string> | null>(null);
  const replayTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const onSelectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
    if (id) setSelectedEdge(null);
  }, []);
  const onSelectEdge = useCallback((e: GraphEdge | null) => {
    setSelectedEdge(e);
    if (e) setSelectedNodeId(null);
  }, []);

  useEffect(() => {
    return () => {
      if (replayTimer.current) clearInterval(replayTimer.current);
    };
  }, []);

  function replayAttackPath() {
    if (!data) return;
    if (replayTimer.current) clearInterval(replayTimer.current);
    const chronological = [...data.edges].sort((a, b) => a.intervalStartMs - b.intervalStartMs).slice(0, 80);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setReplayEdgeIds(new Set(chronological.map((e) => e.id)));
      return;
    }
    let i = 0;
    const seen = new Set<string>();
    setReplayEdgeIds(new Set());
    replayTimer.current = setInterval(() => {
      if (i >= chronological.length) {
        if (replayTimer.current) clearInterval(replayTimer.current);
        return;
      }
      seen.add(chronological[i].id);
      setReplayEdgeIds(new Set(seen));
      i++;
    }, 60);
  }

  const selectedNode = useMemo(() => data?.nodes.find((n) => n.id === selectedNodeId) ?? null, [data, selectedNodeId]);

  if (!caseId) {
    return (
      <EmptyState
        icon={ZoomIn}
        title="No case selected"
        description="Open a case from the Watchfloor (press i on a selected row) to explore its evidence graph."
        phaseNote="Select a case to begin"
      />
    );
  }

  if (!data) {
    return <div className="p-4 text-sm text-text-tertiary">Loading evidence graph…</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <div className="flex items-center gap-3 text-xs text-text-secondary">
          <span data-testid="graph-node-count" className="font-mono">
            {data.nodes.length.toLocaleString()} nodes
          </span>
          <span className="font-mono">{data.edges.length.toLocaleString()} claims</span>
          {fps !== null && (
            <span data-testid="graph-fps" className="font-mono text-text-tertiary">
              {fps.toFixed(0)}fps
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={replayAttackPath} data-testid="replay-attack-path">
          <Play className="size-3.5" aria-hidden="true" />
          Replay attack path
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <GraphCanvas
            nodes={data.nodes}
            edges={data.edges}
            columnCount={data.columnCount}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            onSelectEdge={onSelectEdge}
            highlightedEdgeIds={replayEdgeIds ?? undefined}
            onFpsSample={setFps}
          />
        </div>
        <div className="w-80 shrink-0 overflow-hidden border-l border-hairline bg-surface-1">
          {/* Deliberately NOT mode="wait": with three mutually-exclusive
              conditional children (node panel / claim panel / empty
              state) rather than one stable list, "wait" mode got stuck
              waiting for an exit that never completed -- clicking a
              claim right after a node was selected left the empty-state
              panel showing forever, confirmed with real state
              (selectedEdge was genuinely set) not matching what rendered.
              Found by direct reproduction in a live browser, not by
              inspection (phases/reports/PHASE-11.md). Default (sync)
              mode animates the brief overlap instead and works
              correctly. */}
          <AnimatePresence>
            {selectedNode && (
              <motion.div
                key={`node-${selectedNode.id}`}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
                className="h-full"
              >
                <EntityPanel node={selectedNode} edges={data.edges} onSelectEdge={onSelectEdge} />
              </motion.div>
            )}
            {selectedEdge && (
              <motion.div
                key={`edge-${selectedEdge.id}`}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
                className="h-full"
              >
                <ClaimPanel caseId={caseId} nodesParam={nodesParam} edge={selectedEdge} />
              </motion.div>
            )}
            {!selectedNode && !selectedEdge && (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-3 text-xs text-text-tertiary">
                Click a node for its entity profile, or a claim (edge) for evidence and verification.
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
