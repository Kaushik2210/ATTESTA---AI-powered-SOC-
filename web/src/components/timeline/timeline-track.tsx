"use client";

import { TACTICS } from "@/lib/data/types";
import type { TimelineEvent } from "@/lib/data/types";

const BAND_HEIGHT = 32;
const IDLE_GAP_THRESHOLD_MS = 60 * 60 * 1000; // 1h -- gaps longer than this compress
const COMPRESSED_GAP_PX = 24;

interface Segment {
  startMs: number;
  endMs: number;
  pxStart: number;
  pxWidth: number;
}

/** Builds a piecewise time->pixel mapping that collapses idle stretches
 * longer than IDLE_GAP_THRESHOLD_MS down to a fixed COMPRESSED_GAP_PX,
 * so a multi-day intrusion with long quiet periods still fits on one
 * screen -- docs/UI-SPEC.md's Timeline Reconstructor: "'compress idle
 * time' toggle collapses hours of nothing so a 3-day intrusion fits on
 * one screen." Active stretches keep proportional width; only the gaps
 * between them are what compress.
 */
function buildScale(events: TimelineEvent[], compress: boolean, pxPerMsActive: number): { segments: Segment[]; totalPx: number; toPx: (ms: number) => number } {
  if (events.length === 0) return { segments: [], totalPx: 0, toPx: () => 0 };

  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  const minMs = sorted[0].atMs;
  const maxMs = sorted[sorted.length - 1].atMs;

  if (!compress) {
    const totalPx = Math.max(1, (maxMs - minMs) * pxPerMsActive);
    return {
      segments: [{ startMs: minMs, endMs: maxMs, pxStart: 0, pxWidth: totalPx }],
      totalPx,
      toPx: (ms) => (ms - minMs) * pxPerMsActive,
    };
  }

  const segments: Segment[] = [];
  let segStart = minMs;
  let lastMs = minMs;
  for (const e of sorted.slice(1)) {
    if (e.atMs - lastMs > IDLE_GAP_THRESHOLD_MS) {
      segments.push({ startMs: segStart, endMs: lastMs, pxStart: 0, pxWidth: 0 });
      segStart = e.atMs;
    }
    lastMs = e.atMs;
  }
  segments.push({ startMs: segStart, endMs: lastMs, pxStart: 0, pxWidth: 0 });

  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) cursor += COMPRESSED_GAP_PX;
    const seg = segments[i];
    seg.pxStart = cursor;
    seg.pxWidth = Math.max(4, (seg.endMs - seg.startMs) * pxPerMsActive);
    cursor += seg.pxWidth;
  }

  const toPx = (ms: number) => {
    for (const seg of segments) {
      if (ms >= seg.startMs && ms <= seg.endMs) {
        return seg.pxStart + (ms - seg.startMs) * pxPerMsActive;
      }
    }
    // Falls in a compressed gap -- place it at the nearest segment edge.
    const after = segments.find((s) => ms < s.startMs);
    return after ? after.pxStart : segments[segments.length - 1].pxStart + segments[segments.length - 1].pxWidth;
  };

  return { segments, totalPx: cursor, toPx };
}

export function TimelineTrack({
  events,
  compress,
  zoom,
  selectedEventId,
  onSelect,
}: {
  events: TimelineEvent[];
  compress: boolean;
  zoom: number;
  selectedEventId: string | null;
  onSelect: (id: string) => void;
}) {
  const pxPerMsActive = (0.00006 * zoom) || 0.00006;
  const { toPx, totalPx } = buildScale(events, compress, pxPerMsActive);
  const width = Math.max(800, totalPx + 80);

  return (
    <div className="overflow-x-auto">
      <div style={{ width }} className="relative">
        {TACTICS.map((tactic) => (
          <div
            key={tactic}
            className="flex items-center border-b border-hairline"
            style={{ height: BAND_HEIGHT }}
          >
            <div className="sticky left-0 z-10 w-36 shrink-0 truncate bg-canvas pr-2 font-mono text-[11px] text-text-tertiary">
              {tactic}
            </div>
            <div className="relative h-full flex-1">
              {events
                .filter((e) => e.tactic === tactic)
                .map((e) => {
                  const isSelected = e.id === selectedEventId;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onSelect(e.id)}
                      aria-label={`${e.predicate} on ${e.entity} at ${new Date(e.atMs).toLocaleString()}`}
                      aria-pressed={isSelected}
                      style={{ left: toPx(e.atMs) }}
                      className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform duration-fast ${
                        isSelected ? "scale-150 bg-accent-attesta" : "bg-text-secondary hover:bg-accent-attesta"
                      }`}
                    />
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
