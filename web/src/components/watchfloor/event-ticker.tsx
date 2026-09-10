import type { DetectorFireEvent } from "@/lib/data/types";
import { Activity } from "lucide-react";

/** docs/UI-SPEC.md's Watchfloor: "a live event ticker showing ingest
 * rate and detector fires, so the room can see the system is alive."
 */
export function EventTicker({ fires, ingestRatePerSec, connected }: { fires: DetectorFireEvent[]; ingestRatePerSec: number; connected: boolean }) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Live feed</span>
        <span className="flex items-center gap-1.5 text-xs text-text-secondary">
          <span
            className={`size-1.5 rounded-full ${connected ? "bg-disposition-benign" : "bg-text-tertiary"}`}
            aria-hidden="true"
          />
          {connected ? "connected" : "reconnecting…"}
        </span>
      </div>
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <Activity className="size-3.5 text-text-tertiary" aria-hidden="true" />
        <span className="font-mono text-sm text-text-primary">{ingestRatePerSec.toFixed(1)}</span>
        <span className="text-xs text-text-tertiary">events/sec</span>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {fires.map((f) => (
          <li key={f.id} className="border-b border-hairline px-3 py-1.5 text-xs">
            <div className="truncate font-mono text-text-secondary">{f.ruleId}</div>
            <div className="truncate text-text-tertiary">{f.entity}</div>
          </li>
        ))}
        {fires.length === 0 && <li className="px-3 py-4 text-center text-xs text-text-tertiary">Waiting for detector fires…</li>}
      </ul>
    </aside>
  );
}
