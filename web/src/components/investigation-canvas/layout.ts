import type { GraphNode } from "@/lib/data/types";

export const COLUMN_WIDTH = 160;
export const ROW_HEIGHT = 28;

export interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
  column: number;
}

/** docs/UI-SPEC.md's Investigation Canvas layout: "a time-aware
 * hierarchical layout (left->right by first-seen), not a
 * force-directed hairball. Force layouts look impressive in a
 * screenshot and are useless in an investigation." Nodes are bucketed
 * into `columnCount` time bins by `firstSeenMs`, then packed vertically
 * within their column in a fixed, deterministic order (sorted by id) --
 * no physics simulation, no iterative relaxation, same layout every
 * time for the same graph.
 */
export function layoutNodes(nodes: GraphNode[], columnCount: number): LaidOutNode[] {
  if (nodes.length === 0) return [];
  const minMs = Math.min(...nodes.map((n) => n.firstSeenMs));
  const maxMs = Math.max(...nodes.map((n) => n.firstSeenMs));
  const span = Math.max(1, maxMs - minMs);

  const byColumn = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const column = Math.min(columnCount - 1, Math.floor(((n.firstSeenMs - minMs) / span) * columnCount));
    if (!byColumn.has(column)) byColumn.set(column, []);
    byColumn.get(column)!.push(n);
  }

  const laidOut: LaidOutNode[] = [];
  for (const [column, colNodes] of byColumn) {
    colNodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    colNodes.forEach((n, row) => {
      laidOut.push({ ...n, column, x: column * COLUMN_WIDTH, y: row * ROW_HEIGHT });
    });
  }
  return laidOut;
}
