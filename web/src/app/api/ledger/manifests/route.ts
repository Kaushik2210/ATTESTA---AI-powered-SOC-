import { NextResponse } from "next/server";
import { getLedgerData } from "@/lib/data/ledger";

export async function GET() {
  const { manifests } = await getLedgerData();
  return NextResponse.json({ manifests });
}
