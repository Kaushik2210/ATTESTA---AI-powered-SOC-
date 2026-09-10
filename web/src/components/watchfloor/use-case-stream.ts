"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import type { Case, DetectorFireEvent } from "@/lib/data/types";

type StreamEvent =
  | { kind: "hello"; atMs: number }
  | { kind: "new"; case: Case }
  | { kind: "update"; case: Case }
  | { kind: "fire"; event: DetectorFireEvent };

interface CaseStreamState {
  cases: Map<string, Case>;
  order: string[]; // newest-first for cases the stream itself inserted
  detectorFires: DetectorFireEvent[];
  ingestRatePerSec: number;
  connected: boolean;
}

const TICKER_LIMIT = 40;

/** Watchfloor's live feed -- docs/UI-SPEC.md: "Real-time via SSE with a
 * reconnect strategy." EventSource reconnects natively on its own after
 * a dropped connection (the browser retries the GET automatically); this
 * hook's job is folding incoming events into React state without
 * re-rendering the whole 10k-row table on every tick -- new/updated
 * cases are merged into the initial snapshot's Map, not appended to a
 * growing array.
 */
export function useCaseStream(initialCases: Case[]) {
  const [state, setState] = useState<CaseStreamState>({
    cases: new Map(),
    order: [],
    detectorFires: [],
    ingestRatePerSec: 0,
    connected: false,
  });
  const fireTimestamps = useRef<number[]>([]);
  const seededRef = useRef(false);

  // `initialCases` arrives asynchronously (a React Query fetch) after
  // this hook's first render, which is empty -- a lazy useState
  // initializer would only ever see that first-render emptiness and
  // never pick up the real data once it loads. Seed once, the first
  // time a non-empty array shows up, instead.
  useEffect(() => {
    if (seededRef.current || initialCases.length === 0) return;
    seededRef.current = true;
    setState((s) => ({ ...s, cases: new Map(initialCases.map((c) => [c.id, c])), order: initialCases.map((c) => c.id) }));
  }, [initialCases]);

  useEffect(() => {
    const source = new EventSource("/api/cases/stream");

    source.onopen = () => setState((s) => ({ ...s, connected: true }));
    source.onerror = () => setState((s) => ({ ...s, connected: false }));

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as StreamEvent;
      if (event.kind === "hello") return;

      // A "new"/"update" event forces a fresh `cases` Map reference,
      // which cascades into WatchfloorClient's allCases/filteredCases
      // memo, a full re-sort of the table, and FilterRail's counts --
      // real work over 10,000 rows. Marking it a transition tells React
      // this can be interrupted by (and yield to) whatever's more
      // urgent -- a keystroke, or the browser's own scroll/paint work --
      // instead of blocking a frame the user is actively scrolling
      // through. Found via eval/ui/triage-flow.mjs's real scroll-fps
      // measurement dropping below the Phase 10 gate's 55fps floor.
      if (event.kind === "new") {
        startTransition(() => {
          setState((s) => {
            const cases = new Map(s.cases);
            cases.set(event.case.id, event.case);
            return { ...s, cases, order: [event.case.id, ...s.order] };
          });
        });
        return;
      }

      if (event.kind === "update") {
        startTransition(() => {
          setState((s) => {
            const cases = new Map(s.cases);
            cases.set(event.case.id, event.case);
            return { ...s, cases };
          });
        });
        return;
      }

      // "fire" -- feeds the ticker and the ingest-rate estimate (fires
      // in the trailing 5s window, extrapolated to a per-second rate).
      const now = Date.now();
      fireTimestamps.current = [...fireTimestamps.current, now].filter((t) => now - t < 5000);
      const ratePerSec = fireTimestamps.current.length / 5;

      setState((s) => ({
        ...s,
        detectorFires: [event.event, ...s.detectorFires].slice(0, TICKER_LIMIT),
        ingestRatePerSec: ratePerSec,
      }));
    };

    return () => source.close();
  }, []);

  return state;
}
