import type { BlastRadius } from "@/lib/data/types";
import { AlertTriangle, Server, Users, Workflow } from "lucide-react";

function Section({ icon: Icon, label, items }: { icon: typeof Server; label: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-tertiary">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </div>
      {items.length === 0 ? (
        <span className="text-sm text-text-tertiary">None</span>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {items.map((item) => (
            <li key={item} className="rounded-sm border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text-secondary">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** docs/UI-SPEC.md's Response Console: "Proposed actions with blast
 * radius rendered *before* approval: affected principals, hosts,
 * dependent services, and a criticality flag if the target is a tier-0
 * asset." This component only ever renders once real data has loaded --
 * the loading state is a separate, explicit skeleton in the parent, not
 * a version of this component with empty arrays, so there is no path
 * where "blast radius empty" and "blast radius not loaded yet" render
 * identically.
 */
export function BlastRadiusPanel({ blastRadius }: { blastRadius: BlastRadius }) {
  return (
    <div className="flex flex-col gap-4 rounded-md border border-hairline bg-surface-1 p-3">
      {blastRadius.isTier0 && (
        <div className="flex items-center gap-2 rounded-sm border border-severity-high/30 bg-severity-high/10 px-2 py-1.5 text-sm text-severity-high">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          Tier-0 asset affected
        </div>
      )}
      <Section icon={Users} label="Affected principals" items={blastRadius.affectedPrincipals} />
      <Section icon={Server} label="Affected hosts" items={blastRadius.affectedHosts} />
      <Section icon={Workflow} label="Dependent services" items={blastRadius.dependentServices} />
    </div>
  );
}
