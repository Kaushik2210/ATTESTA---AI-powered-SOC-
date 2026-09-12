import { Xorshift32 } from "./rng";
import type { Case, CaseStatus, Disposition, Severity, Tactic } from "./types";
import { TACTICS } from "./types";

/**
 * Phase 10 scope note (phases/reports/PHASE-10.md): no live control-plane
 * API exists yet (Phase 12) to read real cases from. This generates a
 * large, deterministic, internally-consistent synthetic corpus instead
 * of fabricating arbitrary UI mockup data -- every case's severity and
 * disposition are derived through the same threshold/classification
 * shape the real kernel uses (kernel/src/policy.rs's `classify`,
 * kernel/src/verdict.rs's `disposition_for`), so a screen built against
 * this data doesn't have to be rebuilt when Phase 12 swaps in the real
 * API -- only the fetch call does.
 */

const ENTITY_TYPES = ["host", "user", "process", "ip", "file", "session"] as const;
const HOST_NAMES = ["WIN-CLIENT", "WIN-SRV", "LNX-WEB", "LNX-DB", "MAC-CORP"];
const USER_NAMES = ["jdoe", "asmith", "mchen", "rkumar", "tlee", "svc-backup", "svc-deploy"];
const TENANTS = ["tenant-alpha", "tenant-beta", "tenant-gamma"];
const ASSIGNEES = ["a.patel", "j.nguyen", "k.oconnor", null, null]; // weighted toward unassigned
const TITLE_TEMPLATES = [
  "Credential access burst on {entity}",
  "Suspicious interpreter spawn on {entity}",
  "Lateral movement from {entity}",
  "C2 beacon candidate on {entity}",
  "Privilege escalation attempt on {entity}",
  "Data staging detected on {entity}",
  "Anomalous auth from new ASN for {entity}",
  "Persistence mechanism installed on {entity}",
];

function severityForScore(score: number): Severity {
  if (score >= 8500) return "critical";
  if (score >= 6000) return "high";
  if (score >= 3500) return "medium";
  if (score >= 1500) return "low";
  return "info";
}

function dispositionFor(severity: Severity, incomplete: boolean): Disposition {
  if (incomplete) return "incomplete";
  if (severity === "info" || severity === "low") return "benign";
  if (severity === "medium") return "suspicious";
  return "malicious";
}

function randomEntity(rng: Xorshift32): { entity: string; entityType: (typeof ENTITY_TYPES)[number] } {
  const entityType = rng.pick(ENTITY_TYPES);
  switch (entityType) {
    case "host":
      return { entity: `${rng.pick(HOST_NAMES)}-${rng.int(1, 99).toString().padStart(2, "0")}`, entityType };
    case "user":
      return { entity: `user:${rng.pick(USER_NAMES)}`, entityType };
    case "ip":
      return { entity: `${rng.int(10, 203)}.${rng.int(0, 255)}.${rng.int(0, 255)}.${rng.int(1, 254)}`, entityType };
    case "process":
      return { entity: rng.pick(["powershell.exe", "cmd.exe", "bash", "rundll32.exe", "curl"]), entityType };
    case "file":
      return { entity: `/tmp/${rng.pick(["update", "svc", "cache", "payload"])}.${rng.pick(["bin", "sh", "dll"])}`, entityType };
    case "session":
      return { entity: `sess-${rng.int(100000, 999999)}`, entityType };
  }
}

function tacticsForSeverity(rng: Xorshift32, severity: Severity): Tactic[] {
  const n = severity === "critical" ? rng.int(3, 5) : severity === "high" ? rng.int(2, 4) : rng.int(1, 2);
  return rng.pickN(TACTICS, n).sort((a, b) => TACTICS.indexOf(a) - TACTICS.indexOf(b));
}

function statusForSeverity(rng: Xorshift32, severity: Severity): CaseStatus {
  if (severity === "critical") return rng.pick(["escalated", "investigating", "escalated"] as const);
  if (severity === "high") return rng.pick(["investigating", "escalated", "open"] as const);
  const roll = rng.next();
  if (roll < 0.15) return "dismissed";
  if (roll < 0.35) return "closed";
  if (roll < 0.6) return "investigating";
  return "open";
}

export function generateCase(rng: Xorshift32, index: number, nowMs: number): Case {
  const { entity, entityType } = randomEntity(rng);
  const riskScore = rng.int(0, 10000);
  const severity = severityForScore(riskScore);
  const incomplete = rng.bool(0.04);
  const disposition = dispositionFor(severity, incomplete);
  const tactics = tacticsForSeverity(rng, severity);
  const ageMs = rng.int(60_000, 21 * 24 * 60 * 60 * 1000); // 1 minute .. 21 days
  const title = rng.pick(TITLE_TEMPLATES).replace("{entity}", entity);

  return {
    id: `case-${index.toString(36)}`,
    tenantId: rng.pick(TENANTS),
    title,
    primaryEntity: entity,
    entityType,
    severity,
    disposition,
    riskScore,
    tactics,
    claimCount: rng.int(1, 12),
    createdAtMs: nowMs - ageMs,
    updatedAtMs: nowMs - rng.int(0, Math.min(ageMs, 3_600_000)),
    status: statusForSeverity(rng, severity),
    assignee: rng.pick(ASSIGNEES),
    summary: `${tactics.length} tactic${tactics.length === 1 ? "" : "s"} observed against ${entity} over the last ${Math.round(ageMs / 3_600_000) || 1}h. Risk score ${riskScore}/10000.`,
  };
}

export function generateCases(count: number, seed = 20260910, nowMs = Date.now()): Case[] {
  const rng = new Xorshift32(seed);
  const cases: Case[] = [];
  for (let i = 0; i < count; i++) {
    cases.push(generateCase(rng, i, nowMs));
  }
  return cases;
}

const PREDICATES_BY_TACTIC: Partial<Record<Tactic, string[]>> = {
  "initial-access": ["AUTH_FAILED_BURST", "AUTH_FROM_NEW_ASN"],
  execution: ["INTERPRETER_SPAWNED_BY", "ENCODED_COMMAND"],
  persistence: ["PERSISTENCE_REGISTRY_RUN_KEY"],
  "privilege-escalation": ["PRIVILEGE_ESCALATION_ATTEMPT"],
  "defense-evasion": ["DEFENSE_EVASION_ATTEMPT"],
  "credential-access": ["AUTH_SUCCEEDED_AFTER_FAILURES", "TOKEN_REPLAYED"],
  discovery: ["RDP_INTERNAL_FIRST_TIME"],
  "lateral-movement": ["LATERAL_MOVEMENT_DETECTED"],
  collection: ["DATA_STAGING_DETECTED"],
  "command-and-control": ["INTERPRETER_NETWORK_EGRESS", "CONNECTED_TO_INDICATOR"],
  exfiltration: ["DATA_EXFILTRATED"],
  impact: ["IMPACT_DETECTED"],
};

/** Phase 10 scope note (phases/reports/PHASE-10.md): synthetic per-case
 * event sequence for the Timeline Reconstructor, generated deterministically
 * from the case's own id so repeated visits render identically. Claim ids
 * are shaped like the kernel's own claim_id() hex output (kernel/src/claim.rs)
 * without literally being one -- there is no real claim set behind this
 * case, since no live investigation pipeline is wired to the UI yet.
 */
export function generateTimelineEvents(c: Case, seed: number) {
  const rng = new Xorshift32(seed);
  const events: { id: string; atMs: number; tactic: Tactic; predicate: string; entity: string; claimId: string }[] = [];
  const windowMs = c.updatedAtMs - c.createdAtMs || 60_000;

  for (const tactic of c.tactics) {
    const predicates = PREDICATES_BY_TACTIC[tactic] ?? ["UNKNOWN_PREDICATE"];
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      events.push({
        id: `${c.id}-ev-${events.length}`,
        atMs: c.createdAtMs + Math.round(rng.next() * windowMs),
        tactic,
        predicate: rng.pick(predicates),
        entity: c.primaryEntity,
        claimId: Array.from({ length: 16 }, () => rng.int(0, 15).toString(16)).join(""),
      });
    }
  }

  return events.sort((a, b) => a.atMs - b.atMs);
}

export { severityForScore, dispositionFor, randomEntity, tacticsForSeverity, statusForSeverity, PREDICATES_BY_TACTIC };
