import type { Severity } from "@/lib/data/types";

const SEVERITY_FILL: Record<Severity, string> = {
  info: "bg-severity-info",
  low: "bg-severity-low",
  medium: "bg-severity-medium",
  high: "bg-severity-high",
  critical: "bg-severity-critical",
};

/** dataviz skill's meter spec: "the fill carries severity ... the
 * unfilled track is a lighter step of the same ramp ... so state reads
 * across the whole bar." docs/UI-SPEC.md's Watchfloor: "risk (a compact
 * horizontal meter, not a number alone)." The numeric score is still in
 * the accessible name for screen readers -- the meter is a
 * supplementary visual, per rule 4's "never encode information by hue
 * alone."
 */
export function RiskMeter({ score, severity }: { score: number; severity: Severity }) {
  const pct = Math.round((score / 10000) * 100);
  return (
    <div
      className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-2"
      role="meter"
      aria-valuenow={score}
      aria-valuemin={0}
      aria-valuemax={10000}
      aria-label={`Risk score ${score} of 10000, severity ${severity}`}
    >
      <div className={`h-full rounded-full ${SEVERITY_FILL[severity]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
