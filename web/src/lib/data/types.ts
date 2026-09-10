/**
 * Shared vocabulary with kernel/src/verdict.rs and kernel/src/tactic.rs --
 * the same severity/disposition/tactic names the real Adjudication
 * Kernel emits, not a UI-invented parallel taxonomy. Phase 10 has no
 * live control-plane API to read these from yet (that's Phase 12), so
 * `seed.ts` generates synthetic-but-internally-consistent cases against
 * these exact types -- see that file's own doc comment.
 */

export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const DISPOSITIONS = ["benign", "suspicious", "malicious", "incomplete"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

// kernel/src/tactic.rs's Tactic::ALL, in kill-chain order.
export const TACTICS = [
  "initial-access",
  "execution",
  "persistence",
  "privilege-escalation",
  "defense-evasion",
  "credential-access",
  "discovery",
  "lateral-movement",
  "collection",
  "command-and-control",
  "exfiltration",
  "impact",
] as const;
export type Tactic = (typeof TACTICS)[number];

export const CASE_STATUSES = ["open", "investigating", "escalated", "dismissed", "closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export interface Case {
  id: string;
  tenantId: string;
  title: string;
  primaryEntity: string;
  entityType: "host" | "user" | "process" | "ip" | "file" | "session";
  severity: Severity;
  disposition: Disposition;
  riskScore: number; // 0-10000, kernel's confidence scale (kernel/src/lib.rs clamps 0..10_000)
  tactics: Tactic[];
  claimCount: number;
  createdAtMs: number;
  updatedAtMs: number;
  status: CaseStatus;
  assignee: string | null;
  summary: string;
  dismissReason?: string;
}

export interface DetectorFireEvent {
  id: string;
  atMs: number;
  ruleId: string;
  entity: string;
}

export interface StatTile {
  id: string;
  label: string;
  value: number;
  unit: "count" | "duration_s" | "percent";
  /** Signed delta vs the comparison baseline. */
  delta: number;
  baselineLabel: string;
  /** 12-point trend, oldest first. */
  trend: number[];
  /** Which direction of `delta` reads as an improvement -- the dataviz
   * skill's stat-tile contract: "delta ... color = direction × whether
   * up is good." */
  goodDirection: "up" | "down";
}

export interface TimelineEvent {
  id: string;
  atMs: number;
  tactic: Tactic;
  predicate: string;
  entity: string;
  claimId: string;
}

export type ResponseActionKind =
  | "isolate_host"
  | "disable_account"
  | "revoke_session"
  | "block_indicator"
  | "quarantine_file";

export interface BlastRadius {
  affectedPrincipals: string[];
  affectedHosts: string[];
  dependentServices: string[];
  isTier0: boolean;
}

export interface ResponseAction {
  id: string;
  caseId: string;
  kind: ResponseActionKind;
  target: string;
  proposedAtMs: number;
  rationale: string;
  status: "pending" | "approved" | "modified" | "rejected";
}
