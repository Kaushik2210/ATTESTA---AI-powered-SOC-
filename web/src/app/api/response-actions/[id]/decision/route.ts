import { NextResponse } from "next/server";
import { decideResponseAction } from "@/lib/data/store";

const VALID = new Set(["approved", "modified", "rejected"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const status = body?.status;
  if (typeof status !== "string" || !VALID.has(status)) {
    return NextResponse.json({ error: "status must be one of approved|modified|rejected" }, { status: 400 });
  }
  const updated = decideResponseAction(id, status as "approved" | "modified" | "rejected");
  if (!updated) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ action: updated });
}
