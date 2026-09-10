import { Xorshift32 } from "./rng";
import { generateCases, generateTimelineEvents, severityForScore, dispositionFor } from "./seed";
import type {
  BlastRadius,
  Case,
  DetectorFireEvent,
  ResponseAction,
  ResponseActionKind,
  StatTile,
} from "./types";

const CASE_COUNT = 10_000;

interface Store {
  cases: Map<string, Case>;
  order: string[]; // stable insertion order for the virtualized table
  detectorFires: DetectorFireEvent[];
  responseActions: Map<string, ResponseAction>;
  liveRng: Xorshift32;
  ingestRatePerSec: number;
}

// Cached on globalThis so Next.js's dev-mode module reloads (fast
// refresh re-evaluates route modules on every edit) don't regenerate
// 10,000 cases and reset live state on every save -- the same pattern
// Next's own docs recommend for a dev-only singleton (e.g. a shared
// Prisma client), applied here to this synthetic in-memory store.
const globalForStore = globalThis as unknown as { __attestaStore?: Store };

function buildResponseActions(cases: Case[], rng: Xorshift32): Map<string, ResponseAction> {
  const kinds: ResponseActionKind[] = ["isolate_host", "disable_account", "revoke_session", "block_indicator", "quarantine_file"];
  const actions = new Map<string, ResponseAction>();
  const candidates = cases.filter((c) => c.severity === "high" || c.severity === "critical").slice(0, 40);
  for (const c of candidates) {
    const kind = rng.pick(kinds);
    const id = `ra-${c.id}`;
    actions.set(id, {
      id,
      caseId: c.id,
      kind,
      target: c.primaryEntity,
      proposedAtMs: c.updatedAtMs,
      rationale: `${c.tactics.length} contributing tactic(s), risk score ${c.riskScore}/10000 -- see case ${c.id}.`,
      status: "pending",
    });
  }
  return actions;
}

function initStore(): Store {
  const nowMs = Date.now();
  const cases = generateCases(CASE_COUNT, 20260910, nowMs);
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  const rng = new Xorshift32(0xc0ffee);
  return {
    cases: caseMap,
    order: cases.map((c) => c.id),
    detectorFires: [],
    responseActions: buildResponseActions(cases, rng),
    liveRng: rng,
    ingestRatePerSec: 40,
  };
}

export function getStore(): Store {
  if (!globalForStore.__attestaStore) {
    globalForStore.__attestaStore = initStore();
  }
  return globalForStore.__attestaStore;
}

export function listCases(): Case[] {
  const store = getStore();
  return store.order.map((id) => store.cases.get(id)!);
}

export function getCase(id: string): Case | undefined {
  return getStore().cases.get(id);
}

/** One simulated tick: usually mutate an existing case's risk/status;
 * occasionally spawn a brand-new one, so the Watchfloor's SSE feed and
 * live ticker have something real to show. Returns what changed, for
 * the SSE route to serialize as an event.
 */
export function tick(): { kind: "update"; case: Case } | { kind: "new"; case: Case } | { kind: "fire"; event: DetectorFireEvent } {
  const store = getStore();
  const roll = store.liveRng.next();

  if (roll < 0.06) {
    const id = `case-${Date.now().toString(36)}-${store.liveRng.int(0, 9999)}`;
    const nowMs = Date.now();
    const c = { ...generateCases(1, store.liveRng.int(1, 2 ** 31 - 1), nowMs)[0], id, createdAtMs: nowMs, updatedAtMs: nowMs };
    store.cases.set(id, c);
    store.order.unshift(id);
    return { kind: "new", case: c };
  }

  if (roll < 0.26) {
    // A real feed's risk-ranking doesn't reshuffle wholesale every tick
    // -- most of the queue is stable moment to moment, and updates
    // cluster on the cases already drawing attention. A uniformly-random
    // target with a +/-800 swing (on a 0-10000 scale, for one of 10,000
    // cases, at ~1.4 ticks/sec) would resort the entire table several
    // times a minute, which is both unrealistic and -- found via actual
    // keyboard-navigation testing in phases/reports/PHASE-10.md --
    // breaks j/k's "next row" navigation by teleporting the selection
    // out of view. Small deltas, biased toward the top of the queue.
    const biasedIndex = Math.floor(store.liveRng.next() ** 3 * store.order.length);
    const id = store.order[Math.min(biasedIndex, store.order.length - 1)];
    const existing = store.cases.get(id)!;
    const riskScore = Math.max(0, Math.min(10000, existing.riskScore + store.liveRng.int(-150, 150)));
    const severity = severityForScore(riskScore);
    const updated: Case = {
      ...existing,
      riskScore,
      severity,
      disposition: dispositionFor(severity, existing.disposition === "incomplete"),
      updatedAtMs: Date.now(),
    };
    store.cases.set(id, updated);
    return { kind: "update", case: updated };
  }

  const event: DetectorFireEvent = {
    id: `fire-${Date.now().toString(36)}-${store.liveRng.int(0, 9999)}`,
    atMs: Date.now(),
    ruleId: store.liveRng.pick([
      "cdl.credential.auth-burst-then-success",
      "cdl.execution.interpreter-spawned",
      "cdl.execution.encoded-command",
      "cdl.c2.interpreter-network-egress",
      "cdl.c2.connected-to-indicator",
    ]),
    entity: store.order.length > 0 ? store.cases.get(store.order[store.liveRng.int(0, store.order.length - 1)])!.primaryEntity : "unknown",
  };
  store.detectorFires.push(event);
  if (store.detectorFires.length > 200) store.detectorFires.shift();
  return { kind: "fire", event };
}

export function computeStats(): StatTile[] {
  const cases = listCases();
  const openStatuses = new Set(["open", "investigating", "escalated"]);
  const openCases = cases.filter((c) => openStatuses.has(c.status));
  const rng = new Xorshift32(0x57a75 + openCases.length);

  const trend = (base: number, spread: number) => Array.from({ length: 12 }, () => Math.max(0, Math.round(base + rng.int(-spread, spread))));

  return [
    {
      id: "open-by-severity",
      label: "Open cases",
      value: openCases.length,
      unit: "count",
      delta: openCases.length - Math.round(openCases.length * 0.93),
      baselineLabel: "vs same time yesterday",
      trend: trend(openCases.length, Math.max(1, Math.round(openCases.length * 0.08))),
      goodDirection: "down",
    },
    {
      id: "mttd",
      label: "Mean time to detect",
      value: 47,
      unit: "duration_s",
      delta: -6,
      baselineLabel: "vs trailing 7d",
      trend: trend(50, 8),
      goodDirection: "down",
    },
    {
      id: "mttr",
      label: "Mean time to respond",
      value: 312,
      unit: "duration_s",
      delta: 18,
      baselineLabel: "vs trailing 7d",
      trend: trend(300, 30),
      goodDirection: "down",
    },
    {
      id: "autonomous-close-rate",
      label: "Autonomous-close rate",
      value: 34,
      unit: "percent",
      delta: 3,
      baselineLabel: "vs trailing 30d",
      trend: trend(32, 5),
      goodDirection: "up",
    },
    {
      id: "drift-alerts-today",
      label: "Drift alerts today",
      value: 6,
      unit: "count",
      delta: 2,
      baselineLabel: "vs yesterday",
      trend: trend(5, 3),
      goodDirection: "down",
    },
  ];
}

export function listResponseActions(): ResponseAction[] {
  return Array.from(getStore().responseActions.values());
}

export function getResponseAction(id: string): ResponseAction | undefined {
  return getStore().responseActions.get(id);
}

export function decideResponseAction(id: string, status: ResponseAction["status"]): ResponseAction | undefined {
  const store = getStore();
  const action = store.responseActions.get(id);
  if (!action) return undefined;
  const updated = { ...action, status };
  store.responseActions.set(id, updated);
  return updated;
}

/** Deterministic per-action blast radius -- same shape docs/UI-SPEC.md's
 * Response Console names: affected principals, hosts, dependent
 * services, and a tier-0 flag. The API route adds an artificial delay
 * before returning this (see app/api/response-actions/[id]/blast-radius/route.ts)
 * specifically so the UI has something real to gate the approve control on.
 */
export function computeBlastRadius(action: ResponseAction): BlastRadius {
  const rng = new Xorshift32(action.id.length * 7919 + action.proposedAtMs);
  const principalCount = rng.int(1, 6);
  const hostCount = rng.int(1, 5);
  const serviceCount = rng.int(0, 4);
  const isTier0 = rng.bool(0.2);
  return {
    affectedPrincipals: Array.from({ length: principalCount }, () => `user:${rng.pick(["jdoe", "asmith", "mchen", "rkumar", "svc-backup"])}`),
    affectedHosts: Array.from({ length: hostCount }, () => `${rng.pick(["WIN-CLIENT", "WIN-SRV", "LNX-WEB", "LNX-DB"])}-${rng.int(1, 99)}`),
    dependentServices: Array.from({ length: serviceCount }, () => rng.pick(["billing-api", "auth-gateway", "case-search", "report-export", "ingest-collector"])),
    isTier0,
  };
}

export function getCaseTimeline(caseId: string) {
  const c = getCase(caseId);
  if (!c) return null;
  // Deterministic from the case's own id, so it doesn't reshuffle on
  // every request even though the case's own live fields might.
  let seed = 0;
  for (let i = 0; i < caseId.length; i++) seed = (seed * 31 + caseId.charCodeAt(i)) | 0;
  return generateTimelineEvents(c, seed);
}
