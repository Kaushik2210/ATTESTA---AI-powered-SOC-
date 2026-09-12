import { Xorshift32 } from "./rng";
import { PREDICATES_BY_TACTIC } from "./seed";
import { buildMerkleTree, proveInclusion, type InclusionProof } from "@/lib/kernel/merkle";
import type { GraphEdge, GraphEntityType, GraphNode, Tactic } from "./types";

const ENTITY_TYPES: GraphEntityType[] = ["host", "user", "process", "ip", "file", "session"];
const ENTITY_PREFIX: Record<GraphEntityType, string> = {
  host: "host",
  user: "user",
  process: "proc",
  ip: "ip",
  file: "file",
  session: "sess",
};

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

export interface Graph {
  caseId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Assigns each node a deterministic time-column index (0-based,
   * left-to-right by first-seen) -- the layout basis docs/UI-SPEC.md
   * requires ("time-aware hierarchical layout ... left->right by
   * first-seen, not a force-directed hairball"). The canvas component
   * turns this into actual pixel positions; this module only owns the
   * data-derived ordering. */
  columnCount: number;
}

/** Generates a deterministic evidence graph for `caseId`. Node/edge
 * count defaults to a value derived from the case id's own hash (so
 * different cases render different scales, like a real investigation
 * would), clamped to [300, 10000]; `nodeCountOverride` lets the Phase 11
 * gate script (eval/ui/investigation-flow.mjs) force exactly 10,000 for
 * the fps measurement docs/UI-SPEC.md's gate names.
 */
export function generateGraph(caseId: string, nodeCountOverride?: number): Graph {
  const seed = hashSeed(caseId);
  const rng = new Xorshift32(seed);
  const nodeCount = nodeCountOverride ?? Math.min(10_000, Math.max(300, Math.abs(seed) % 12_000));
  const columnCount = 40;

  const nowMs = Date.now();
  const spanMs = 5 * 24 * 60 * 60 * 1000; // a 5-day investigation window

  const nodes: GraphNode[] = [];
  const nodesByType: Record<GraphEntityType, string[]> = { host: [], user: [], process: [], ip: [], file: [], session: [] };

  for (let i = 0; i < nodeCount; i++) {
    const type = ENTITY_TYPES[i % ENTITY_TYPES.length];
    const id = `${ENTITY_PREFIX[type]}-${caseId}-${i}`;
    // Skewed toward the start, like a real intrusion: most entities show
    // up early (recon/initial access), fewer keep appearing as it
    // progresses.
    const firstSeenMs = nowMs - spanMs + Math.floor((rng.next() ** 1.6) * spanMs);
    nodes.push({ id, type, label: id, firstSeenMs, priorCaseCount: rng.int(0, 6) });
    nodesByType[type].push(id);
  }

  const tactics = Object.keys(PREDICATES_BY_TACTIC) as Tactic[];
  const edgeCount = Math.round(nodeCount * 1.3);
  const edges: GraphEdge[] = [];
  for (let i = 0; i < edgeCount; i++) {
    const fromNode = nodes[rng.int(0, nodes.length - 1)];
    const toNode = nodes[rng.int(0, nodes.length - 1)];
    if (fromNode.id === toNode.id) continue;

    const tactic = rng.pick(tactics);
    const predicates = PREDICATES_BY_TACTIC[tactic] ?? ["UNKNOWN_PREDICATE"];
    const intervalStartMs = Math.max(fromNode.firstSeenMs, toNode.firstSeenMs);
    const evidenceCount = rng.int(1, 3);
    const evidenceIds = Array.from(
      { length: evidenceCount },
      () => `blake3:${Array.from({ length: 16 }, () => rng.int(0, 15).toString(16)).join("")}`,
    );

    edges.push({
      id: `${caseId}-claim-${i}-${Array.from({ length: 8 }, () => rng.int(0, 15).toString(16)).join("")}`,
      fromNodeId: fromNode.id,
      toNodeId: toNode.id,
      predicate: rng.pick(predicates),
      polarity: rng.bool(0.9) ? "supports" : "refutes",
      intervalStartMs,
      intervalEndMs: intervalStartMs + rng.int(1, 4000),
      extractorKind: "rule",
      extractorId: `cdl.${tactic}.${rng.pick(predicates).toLowerCase()}`,
      extractorVersion: "1",
      confidence: rng.int(1000, 9500),
      evidenceIds,
      hypothesisGroup: rng.bool(0.15) ? `hyp-${rng.int(1, 3)}` : null,
    });
  }

  return { caseId, nodes, edges, columnCount };
}

// Cached per (caseId, nodeCountOverride) on globalThis, same rationale
// as store.ts/ledger.ts -- Next.js dev-mode HMR shouldn't regenerate and
// reshuffle a 10,000-node graph (and its Merkle tree) on every save.
interface GraphCacheEntry {
  graph: Graph;
  tree: ReturnType<typeof buildMerkleTree>;
  evidenceIds: string[];
}
const globalForGraph = globalThis as unknown as { __attestaGraphCache?: Map<string, GraphCacheEntry> };
if (!globalForGraph.__attestaGraphCache) globalForGraph.__attestaGraphCache = new Map();

export function getOrBuildGraph(caseId: string, nodeCountOverride?: number): GraphCacheEntry {
  const key = `${caseId}:${nodeCountOverride ?? "auto"}`;
  const cache = globalForGraph.__attestaGraphCache!;
  const cached = cache.get(key);
  if (cached) return cached;

  const graph = generateGraph(caseId, nodeCountOverride);
  const evidenceIds = Array.from(new Set(graph.edges.flatMap((e) => e.evidenceIds))).sort();
  const tree = buildMerkleTree(evidenceIds);
  const entry: GraphCacheEntry = { graph, tree, evidenceIds };
  cache.set(key, entry);
  return entry;
}

export function proveGraphEvidenceInclusion(caseId: string, nodeCountOverride: number | undefined, evidenceId: string): InclusionProof | null {
  const { tree, evidenceIds } = getOrBuildGraph(caseId, nodeCountOverride);
  const index = evidenceIds.indexOf(evidenceId);
  if (index === -1) return null;
  return proveInclusion(tree, index);
}
