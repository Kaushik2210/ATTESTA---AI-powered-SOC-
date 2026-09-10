import { NextResponse } from "next/server";
import { listResponseActions } from "@/lib/data/store";

export async function GET() {
  return NextResponse.json({ actions: listResponseActions() });
}
