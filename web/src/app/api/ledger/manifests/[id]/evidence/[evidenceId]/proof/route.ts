import { NextResponse } from "next/server";
import { proveEvidenceInclusion } from "@/lib/data/ledger";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  const { id, evidenceId } = await params;
  const proof = await proveEvidenceInclusion(id, decodeURIComponent(evidenceId));
  if (!proof) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ proof });
}
