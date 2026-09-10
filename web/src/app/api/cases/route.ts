import { NextResponse } from "next/server";
import { listCases } from "@/lib/data/store";

export async function GET() {
  return NextResponse.json({ cases: listCases() });
}
