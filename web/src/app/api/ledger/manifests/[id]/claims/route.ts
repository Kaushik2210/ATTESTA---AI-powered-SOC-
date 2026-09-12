import { NextResponse } from "next/server";
import { getLedgerData } from "@/lib/data/ledger";

/** What the Verdict Ledger's verification panel fetches
 * (docs/UI-SPEC.md §4: "fetches the claim set") before running the real
 * kernel client-side against it -- the claims, the policy they're
 * adjudicated under, and the evidence id list a proof can be requested
 * for. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { caseData, policy } = await getLedgerData();
  const c = caseData.get(id);
  if (!c) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ claims: c.claims, policy, evidenceIds: c.evidenceIds, merkleRoot: c.merkleRoot });
}
