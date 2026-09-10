"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { Case } from "@/lib/data/types";
import { useCaseStream } from "./use-case-stream";
import { FilterRail, applyFilters, emptyFilterState, type FilterState } from "./filter-rail";
import { CaseTable } from "./case-table";
import { EventTicker } from "./event-ticker";
import { StatStrip } from "./stat-strip";
import { DismissDialog } from "./dismiss-dialog";
import { useConsoleChrome } from "@/components/console-chrome-provider";

async function fetchInitialCases(): Promise<Case[]> {
  const res = await fetch("/api/cases");
  const data = await res.json();
  return data.cases;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable || tag === "SELECT";
}

/** The Watchfloor -- docs/UI-SPEC.md surface 1. Client component: the
 * SSE feed, filtering, sorting, and the j/k/e/d/i queue shortcuts are
 * all inherently client-side state. See phases/reports/PHASE-10.md for
 * the synthetic-data scope note this and every Phase 10 surface shares.
 */
export function WatchfloorClient() {
  const router = useRouter();
  const { paletteOpen, helpOpen } = useConsoleChrome();
  const { data: initialCases } = useQuery({ queryKey: ["cases-initial"], queryFn: fetchInitialCases, staleTime: Infinity });
  const [filters, setFilters] = useState<FilterState>(emptyFilterState());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Map<string, Partial<Case>>>(new Map());
  const [dismissTarget, setDismissTarget] = useState<Case | null>(null);

  const stream = useCaseStream(initialCases ?? []);

  const allCases = useMemo(() => {
    return stream.order.map((id) => {
      const base = stream.cases.get(id)!;
      const override = overrides.get(id);
      return override ? { ...base, ...override } : base;
    });
  }, [stream.order, stream.cases, overrides]);

  const filteredCases = useMemo(() => applyFilters(allCases, filters), [allCases, filters]);

  const setStatus = (id: string, patch: Partial<Case>) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(id, { ...next.get(id), ...patch });
      return next;
    });
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (paletteOpen || helpOpen || isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (filteredCases.length === 0) return;

      // The table re-sorts live (risk scores change under the SSE feed),
      // so "next row" only means anything relative to *where the
      // selection currently is in the current order* -- recomputed on
      // every keypress from selectedId, never a separately-tracked index
      // that would silently drift out of sync the moment a click (or a
      // live re-sort) moved the selection without going through here.
      const currentIndex = selectedId ? filteredCases.findIndex((c) => c.id === selectedId) : -1;

      switch (event.key) {
        case "j": {
          event.preventDefault();
          const nextIndex = Math.min(currentIndex + 1, filteredCases.length - 1);
          setSelectedId(filteredCases[Math.max(nextIndex, 0)].id);
          break;
        }
        case "k": {
          event.preventDefault();
          const nextIndex = Math.max(currentIndex - 1, 0);
          setSelectedId(filteredCases[nextIndex].id);
          break;
        }
        case "e": {
          if (!selectedId) return;
          event.preventDefault();
          setStatus(selectedId, { status: "escalated" });
          break;
        }
        case "d": {
          if (!selectedId) return;
          event.preventDefault();
          const target = filteredCases.find((c) => c.id === selectedId) ?? null;
          setDismissTarget(target);
          break;
        }
        case "i": {
          if (!selectedId) return;
          event.preventDefault();
          router.push(`/investigation-canvas?case=${selectedId}`);
          break;
        }
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filteredCases, selectedId, paletteOpen, helpOpen, router]);

  return (
    <div className="flex h-full flex-col">
      <StatStrip />
      <div className="flex min-h-0 flex-1">
        <FilterRail cases={allCases} filters={filters} onChange={setFilters} />
        <CaseTable cases={filteredCases} selectedId={selectedId} onSelect={setSelectedId} />
        <EventTicker fires={stream.detectorFires} ingestRatePerSec={stream.ingestRatePerSec} connected={stream.connected} />
      </div>
      <DismissDialog
        open={dismissTarget !== null}
        caseTitle={dismissTarget?.title ?? ""}
        onOpenChange={(open) => !open && setDismissTarget(null)}
        onConfirm={(reason) => {
          if (dismissTarget) setStatus(dismissTarget.id, { status: "dismissed", dismissReason: reason });
        }}
      />
    </div>
  );
}
