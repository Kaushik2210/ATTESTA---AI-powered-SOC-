import { NextResponse } from "next/server";
import { computeBlastRadius, getResponseAction } from "@/lib/data/store";

/** Deliberately slow (docs/UI-SPEC.md's Response Console: "blast radius
 * rendered *before* approval" -- and phases/PHASES.md's Phase 10 gate:
 * "assert the approve button is disabled until blast radius has
 * loaded"). A real blast-radius computation queries asset/dependency
 * graphs and genuinely takes real time; this delay is what gives the
 * UI's loading state something honest to show, and what the gate test
 * actually asserts against.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const action = getResponseAction(id);
  if (!action) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await new Promise((resolve) => setTimeout(resolve, 900));
  return NextResponse.json({ blastRadius: computeBlastRadius(action) });
}
