import { NextResponse } from "next/server";
import { getOrBuildGraph } from "@/lib/data/graph";

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const { searchParams } = new URL(request.url);
  const nodesParam = searchParams.get("nodes");
  const nodeCountOverride = nodesParam ? Number(nodesParam) : undefined;

  const { graph, evidenceIds } = getOrBuildGraph(caseId, nodeCountOverride);
  return NextResponse.json({ nodes: graph.nodes, edges: graph.edges, columnCount: graph.columnCount, evidenceIds });
}
