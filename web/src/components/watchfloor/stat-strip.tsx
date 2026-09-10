"use client";

import { useQuery } from "@tanstack/react-query";
import type { StatTile as StatTileData } from "@/lib/data/types";
import { StatTile } from "@/components/dataviz/stat-tile";

async function fetchStats(): Promise<StatTileData[]> {
  const res = await fetch("/api/stats");
  const data = await res.json();
  return data.tiles;
}

export function StatStrip() {
  const { data: tiles } = useQuery({ queryKey: ["stats"], queryFn: fetchStats, refetchInterval: 15_000 });

  return (
    <div className="flex shrink-0 border-b border-hairline bg-surface-1">
      {(tiles ?? []).map((tile) => (
        <StatTile key={tile.id} tile={tile} />
      ))}
    </div>
  );
}
