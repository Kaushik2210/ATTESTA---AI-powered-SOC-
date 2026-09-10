"use client";

import { useEffect, useRef, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Case } from "@/lib/data/types";
import { RiskMeter } from "./risk-meter";
import { DispositionLabel } from "./severity-badge";
import { TacticChips } from "./tactic-chips";
import { ArrowUpDown } from "lucide-react";

function relativeAge(ms: number): string {
  const deltaS = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (deltaS < 60) return `${deltaS}s`;
  if (deltaS < 3600) return `${Math.round(deltaS / 60)}m`;
  if (deltaS < 86400) return `${Math.round(deltaS / 3600)}h`;
  return `${Math.round(deltaS / 86400)}d`;
}

const columnHelper = createColumnHelper<Case>();

const columns = [
  columnHelper.accessor("riskScore", {
    header: "Risk",
    cell: (info) => <RiskMeter score={info.getValue()} severity={info.row.original.severity} />,
    size: 72,
  }),
  columnHelper.accessor("title", {
    header: "Title",
    cell: (info) => (
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-text-primary">{info.getValue()}</span>
        <DispositionLabel disposition={info.row.original.disposition} />
      </div>
    ),
    size: 340,
  }),
  columnHelper.accessor("primaryEntity", {
    header: "Primary entity",
    cell: (info) => <span className="truncate font-mono text-xs text-text-secondary">{info.getValue()}</span>,
    size: 160,
  }),
  columnHelper.accessor("tactics", {
    header: "Tactics",
    cell: (info) => <TacticChips tactics={info.getValue()} />,
    size: 220,
    enableSorting: false,
  }),
  columnHelper.accessor("claimCount", { header: "Claims", size: 70 }),
  columnHelper.accessor("updatedAtMs", {
    header: "Age",
    cell: (info) => <span className="font-mono text-xs text-text-tertiary">{relativeAge(info.row.original.createdAtMs)}</span>,
    size: 60,
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => <span className="text-xs capitalize text-text-secondary">{info.getValue()}</span>,
    size: 100,
  }),
  columnHelper.accessor("assignee", {
    header: "Assignee",
    cell: (info) => <span className="truncate text-xs text-text-secondary">{info.getValue() ?? "—"}</span>,
    size: 100,
  }),
];

const ROW_HEIGHT = 32; // density-9 compact row height (attesta-row-default)
const EXPANDED_EXTRA_HEIGHT = 56;

/** docs/UI-SPEC.md's Watchfloor center panel: a virtualized case table
 * (TanStack Table + Virtual per the component-quality bar), risk as a
 * meter, row expands inline to a 3-line summary. Phase 10's gate needs
 * this to sustain smooth scrolling at 10,000 rows -- see
 * eval/ui/triage-flow.mjs's fps measurement, which drives an actual
 * scroll and counts real animation frames rather than trusting a
 * synthetic benchmark.
 */
export function CaseTable({
  cases,
  selectedId,
  onSelect,
}: {
  cases: Case[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "riskScore", desc: true }]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const table = useReactTable({
    data: cases,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

  const rows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.id === expandedId ? ROW_HEIGHT + EXPANDED_EXTRA_HEIGHT : ROW_HEIGHT),
    overscan: 6,
  });

  // Keep keyboard navigation (j/k, driven from the parent) visible: the
  // table re-sorts live, so the selected row's index can move even
  // without a manual scroll. Only follows external (keyboard) selection
  // changes, not the click handler's own setExpandedId/onSelect --
  // those already happened inside the viewport by definition.
  useEffect(() => {
    if (!selectedId) return;
    const index = rows.findIndex((r) => r.id === selectedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally NOT reacting to `rows`/`virtualizer` identity changes (which change every SSE tick); only to selectedId actually changing.
  }, [selectedId]);

  return (
    <div className="flex h-full min-w-0 flex-col" role="grid" aria-rowcount={rows.length} aria-label="Case queue">
      <div className="flex shrink-0 border-b border-hairline bg-surface-1 text-xs text-text-tertiary" role="row">
        {table.getFlatHeaders().map((header) => (
          <button
            key={header.id}
            type="button"
            role="columnheader"
            aria-sort={header.column.getIsSorted() ? (header.column.getIsSorted() === "asc" ? "ascending" : "descending") : "none"}
            onClick={header.column.getToggleSortingHandler()}
            disabled={!header.column.getCanSort()}
            style={{ width: header.getSize() }}
            className="flex shrink-0 items-center gap-1 px-2 py-1.5 text-left font-medium uppercase tracking-wide enabled:cursor-pointer enabled:hover:text-text-secondary"
          >
            {flexRender(header.column.columnDef.header, header.getContext())}
            {header.column.getCanSort() && <ArrowUpDown className="size-2.5" aria-hidden="true" />}
          </button>
        ))}
      </div>

      {/* role="rowgroup" keeps this a valid child of the grid role above
          once tabIndex gives it an accessibility-tree presence of its
          own (a plain div would otherwise be pruned as presentational,
          but a tabIndex forces a real node, which then needs a role
          `grid` accepts). tabIndex+rowgroup together satisfy
          scrollable-region-focusable: the scroll region has no natively
          focusable descendant of its own -- selection/navigation is
          driven by the j/k global keyboard handler in
          watchfloor-client.tsx, a deliberately simpler model than a
          full per-cell roving-tabindex grid for this phase. */}
      <div ref={parentRef} tabIndex={0} role="rowgroup" className="min-h-0 flex-1 overflow-auto" data-testid="case-table-scroll">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            const c = row.original;
            const isExpanded = expandedId === c.id;
            const isSelected = selectedId === c.id;

            return (
              <div
                key={row.id}
                data-index={virtualRow.index}
                // measureElement wires up a ResizeObserver on the node --
                // real per-row cost at 10k rows. Only the expanded row's
                // height actually varies (ROW_HEIGHT + EXPANDED_EXTRA_HEIGHT
                // vs. the fixed ROW_HEIGHT estimateSize already gives every
                // other row), so only it needs to be measured; giving every
                // scrolled-through row its own observer made frame time
                // degrade progressively over a scroll -- found via
                // eval/ui/triage-flow.mjs's fps measurement.
                ref={isExpanded ? virtualizer.measureElement : undefined}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
              >
                <div
                  role="row"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onClick={() => {
                    onSelect(c.id);
                    setExpandedId(isExpanded ? null : c.id);
                  }}
                  className={`flex h-8 cursor-pointer items-center border-b border-hairline text-sm transition-colors duration-fast ${
                    isSelected ? "bg-hover" : "hover:bg-hover"
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <div key={cell.id} role="gridcell" style={{ width: cell.column.getSize() }} className="shrink-0 truncate px-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
                {isExpanded && (
                  <div className="border-b border-hairline bg-surface-1 px-4 py-2 text-xs text-text-secondary">
                    {c.summary}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
