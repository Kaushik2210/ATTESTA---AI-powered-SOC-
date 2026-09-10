import { NextResponse } from "next/server";
import { computeStats } from "@/lib/data/store";

export async function GET() {
  return NextResponse.json({ tiles: computeStats() });
}
