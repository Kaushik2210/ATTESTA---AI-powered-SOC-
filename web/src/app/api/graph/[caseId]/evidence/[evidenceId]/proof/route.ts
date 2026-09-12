import { NextResponse } from "next/server";
import { proveGraphEvidenceInclusion } from "@/lib/data/graph";

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string; evidenceId: string }> }) {
  const { caseId, evidenceId } = await params;
  const { searchParams } = new URL(request.url);
  const nodesParam = searchParams.get("nodes");
  const nodeCountOverride = nodesParam ? Number(nodesParam) : undefined;

  const proof = proveGraphEvidenceInclusion(caseId, nodeCountOverride, decodeURIComponent(evidenceId));
  if (!proof) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ proof });
}
