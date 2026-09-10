import { ArrowDown, ArrowUp } from "lucide-react";
import type { StatTile as StatTileData } from "@/lib/data/types";
import { formatStatValue } from "./format";
import { Sparkline } from "./sparkline";

/** dataviz skill's stat-tile contract: label · value (semibold, auto-compact,
 * proportional figures -- never tabular-nums at display size) · delta
 * (signed, colored by direction x whether up is good) · trend (sparkline).
 * "Never a bare big number" (docs/UI-SPEC.md's Watchfloor spec) is why
 * delta and trend are not optional decoration here -- every tile carries
 * both.
 */
export function StatTile({ tile }: { tile: StatTileData }) {
  const isImprovement = tile.goodDirection === "up" ? tile.delta > 0 : tile.delta < 0;
  const isFlat = tile.delta === 0;
  const deltaColorClass = isFlat ? "text-text-tertiary" : isImprovement ? "text-disposition-benign" : "text-severity-high";
  const DeltaIcon = tile.delta >= 0 ? ArrowUp : ArrowDown;
  const deltaUnitSuffix = tile.unit === "percent" ? "pp" : tile.unit === "duration_s" ? "s" : "";

  return (
    <div className="flex flex-1 flex-col gap-1.5 border-r border-hairline px-4 py-2.5 last:border-r-0">
      <span className="text-xs text-text-secondary">{tile.label}</span>
      <div className="flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold text-text-primary">{formatStatValue(tile.value, tile.unit)}</span>
        <Sparkline values={tile.trend} />
      </div>
      <div className="flex items-center gap-1 text-xs">
        {!isFlat && (
          <span className={`flex items-center ${deltaColorClass}`}>
            <DeltaIcon className="size-3" aria-hidden="true" />
            {Math.abs(tile.delta)}
            {deltaUnitSuffix}
          </span>
        )}
        <span className="text-text-tertiary">{tile.baselineLabel}</span>
      </div>
    </div>
  );
}
