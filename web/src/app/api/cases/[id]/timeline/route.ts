import { NextResponse } from "next/server";
import { getCase, getCaseTimeline } from "@/lib/data/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getCase(id);
  if (!c) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ case: c, events: getCaseTimeline(id) });
}
