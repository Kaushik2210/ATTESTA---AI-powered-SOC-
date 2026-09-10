import type { Disposition, Severity } from "@/lib/data/types";

const SEVERITY_TEXT: Record<Severity, string> = {
  info: "text-severity-info",
  low: "text-severity-low",
  medium: "text-severity-medium",
  high: "text-severity-high",
  critical: "text-severity-critical",
};

const DISPOSITION_TEXT: Record<Disposition, string> = {
  benign: "text-disposition-benign",
  suspicious: "text-disposition-suspicious",
  malicious: "text-disposition-malicious",
  incomplete: "text-disposition-incomplete",
};

/** docs/UI-SPEC.md rule 4: "Never encode information by hue alone --
 * pair with icon, label, or position." Severity/disposition always
 * render as colored TEXT alongside their own word, never a bare
 * color swatch.
 */
export function SeverityLabel({ severity }: { severity: Severity }) {
  return <span className={`text-xs font-medium capitalize ${SEVERITY_TEXT[severity]}`}>{severity}</span>;
}

export function DispositionLabel({ disposition }: { disposition: Disposition }) {
  return <span className={`text-xs font-medium capitalize ${DISPOSITION_TEXT[disposition]}`}>{disposition}</span>;
}
