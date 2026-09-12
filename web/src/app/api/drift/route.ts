import { NextResponse } from "next/server";
import { getDriftData } from "@/lib/data/drift";

export async function GET() {
  const drifts = await getDriftData();
  return NextResponse.json({ drifts });
}
