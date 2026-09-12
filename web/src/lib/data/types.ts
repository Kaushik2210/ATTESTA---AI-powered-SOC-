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

// ---- Phase 11: Investigation Canvas, Verdict Ledger, Drift Monitor ----
// Matching services/adjudicate/attesta_adjudicate/manifest.py's Manifest/
// SealedManifest (field-for-field) and kernel/wasm_bridge's KernelRequest
// claim shape (web/src/lib/kernel/kernel-wasm.ts) -- see
// phases/reports/PHASE-11.md for exactly what's real vs. synthetic here.

export interface LedgerClaim {
  predicate: string;
  subject: string;
  object: string | null;
  interval_start_ns: number;
  interval_end_ns: number;
  evidence: string[];
  extractor_kind: string;
  extractor_id: string;
  extractor_version: string;
  observed_value: number | null;
  polarity: "supports" | "refutes";
  hypothesis_ref: string | null;
  /** Populated only after the kernel has computed it (kernel/src/claim.rs's
   * claim_id()) -- never invented client-side. */
  claim_id: string;
}

export interface InferenceMeta {
  provider: string;
  model_id: string;
  weights_digest: string;
  seed: number | null;
}

export interface Manifest {
  investigation_id: string;
  tenant_id: string;
  case_id: string;
  epoch_root: string;
  epoch_id: number;
  index_snapshot_hash: string;
  claim_set_hash: string;
  claim_ids: string[];
  inference: InferenceMeta;
  policy_version: string;
  kernel_version: string;
  attack_model_version: string;
  verdict_severity: Severity;
  verdict_confidence: number;
  verdict_disposition: Disposition;
  verdict_hash: string;
  budget_consumed: { tool_calls: number; turns: number };
  started_at_ns: number;
  completed_at_ns: number;
  prev_manifest_hash: string;
}

export interface SealedManifest {
  manifest: Manifest;
  manifest_hash: string;
  signature: string;
  public_key: string;
  /** Deliberately seeded on exactly one row per tenant so the Verdict
   * Ledger's "broken chain" state (docs/UI-SPEC.md §4) has something
   * real to render -- see phases/reports/PHASE-11.md. */
  chainBroken?: boolean;
}

export interface PolicyDelta {
  predicate: string;
  old_weight: number;
  new_weight: number;
}

export interface AttributedClaim {
  claim_id: string;
  predicate: string;
  attributed_weight: number;
}

export interface VerdictDrift {
  case_id: string;
  tenant_id: string;
  old_severity: Severity;
  new_severity: Severity;
  old_disposition: Disposition;
  new_disposition: Disposition;
  old_verdict_hash: string;
  new_verdict_hash: string;
  /** kernel/src/verdict.rs's ContributingClaim, before and after --
   * docs/UI-SPEC.md §5's "before/after kernel-attribution comparison:
   * which claims contributed what weight, then and now" -- both are
   * real kernel output, not fabricated for the diff. */
  old_contributing_claims: AttributedClaim[];
  new_contributing_claims: AttributedClaim[];
  responsible_claim_ids: string[];
  policy_deltas: PolicyDelta[];
  indicator_corpus_version: string;
  indicator_corpus_hash: string;
  flipped_at_ms: number;
  closed_at_ms: number;
}

export type GraphEntityType = "host" | "user" | "process" | "ip" | "file" | "session";

export interface GraphNode {
  id: string;
  type: GraphEntityType;
  label: string;
  firstSeenMs: number;
  priorCaseCount: number;
}

export interface GraphEdge {
  id: string; // claim_id, hex
  fromNodeId: string;
  toNodeId: string;
  predicate: string;
  polarity: "supports" | "refutes";
  intervalStartMs: number;
  intervalEndMs: number;
  extractorKind: string;
  extractorId: string;
  extractorVersion: string;
  confidence: number;
  evidenceIds: string[];
  hypothesisGroup: string | null;
}
