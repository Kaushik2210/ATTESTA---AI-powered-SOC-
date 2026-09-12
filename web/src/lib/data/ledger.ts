import { blake3 } from "@noble/hashes/blake3.js";
import { Xorshift32 } from "./rng";
import { listCases } from "./store";
import { PREDICATES_BY_TACTIC } from "./seed";
import { buildSyntheticPolicy } from "./policy";
import { buildMerkleTree, proveInclusion, type InclusionProof } from "@/lib/kernel/merkle";
import { verifyClaimSetServer } from "@/lib/kernel/kernel-wasm-server";
import type { KernelRequest } from "@/lib/kernel/kernel-wasm";
import type { LedgerClaim, Manifest, SealedManifest, Severity, Disposition, Tactic } from "./types";

const KERNEL_VERSION = "0.0.0-phase11";
const ZERO_HASH = "0".repeat(64);
const MANIFESTS_PER_TENANT = 14;
// Matches seed.ts's actual Case.tenantId values exactly (lowercase,
// hyphenated) -- NOT the Watchfloor UI's capitalized display label.
// Found via a real empty-manifests-list repro, not by inspection
// (phases/reports/PHASE-11.md): a capitalized mismatch here silently
// filtered every case out of every tenant, with no error anywhere.
const TENANTS = ["tenant-alpha", "tenant-beta", "tenant-gamma"];

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function syntheticHash(value: unknown): string {
  return hex(blake3(new TextEncoder().encode(JSON.stringify(value))));
}

/** Builds a plausible claim set for one investigation, drawing from the
 * same predicate vocabulary seed.ts's Timeline generator uses so the
 * whole product agrees on what a real detector fires -- but every
 * `claim_id` here is populated only after the real kernel computes it
 * (see buildManifest below), never invented client-side. */
function generateClaims(rng: Xorshift32, entity: string, baseNs: number): Omit<LedgerClaim, "claim_id">[] {
  const tactics = rng.pickN(Object.keys(PREDICATES_BY_TACTIC) as Tactic[], rng.int(2, 4));
  const claims: Omit<LedgerClaim, "claim_id">[] = [];
  let cursorNs = baseNs;
  for (const tactic of tactics) {
    const predicates = PREDICATES_BY_TACTIC[tactic] ?? [];
    const predicate = rng.pick(predicates);
    cursorNs += rng.int(1, 600) * 1_000_000_000;
    const evidenceCount = rng.int(1, 3);
    const evidence = Array.from(
      { length: evidenceCount },
      () => `blake3:${Array.from({ length: 16 }, () => rng.int(0, 15).toString(16)).join("")}`,
    );
    claims.push({
      predicate,
      subject: entity,
      object: rng.bool(0.4) ? rng.pick(["powershell.exe", "cmd.exe", "bash", "203.0.113.7"]) : null,
      interval_start_ns: cursorNs,
      interval_end_ns: cursorNs + rng.int(1, 5_000_000_000),
      evidence,
      extractor_kind: "rule",
      extractor_id: `cdl.${tactic}.${predicate.toLowerCase()}`,
      extractor_version: "1",
      observed_value: rng.bool(0.6) ? rng.int(1, 200) : null,
      polarity: rng.bool(0.92) ? "supports" : "refutes",
      hypothesis_ref: null,
    });
  }
  return claims;
}

export interface LedgerCaseData {
  investigationId: string;
  caseId: string;
  claims: LedgerClaim[];
  merkleRoot: string;
  merkleTree: ReturnType<typeof buildMerkleTree>;
  evidenceIds: string[];
}

export interface LedgerData {
  manifests: SealedManifest[];
  caseData: Map<string, LedgerCaseData>; // keyed by investigation_id
  policy: KernelRequest["policy"];
}

async function buildManifest(
  rng: Xorshift32,
  tenantId: string,
  caseId: string,
  entity: string,
  prevManifestHash: string,
  policy: KernelRequest["policy"],
  makeBroken: boolean,
): Promise<{ sealed: SealedManifest; caseData: LedgerCaseData }> {
  const investigationId = `inv-${caseId}-${Array.from({ length: 6 }, () => rng.int(0, 15).toString(16)).join("")}`;
  const baseNs = Date.now() * 1_000_000 - rng.int(0, 30) * 86_400 * 1_000_000_000;
  const claimsRaw = generateClaims(rng, entity, baseNs);

  const request: KernelRequest = { kernel_version: KERNEL_VERSION, policy, claims: claimsRaw };
  const result = await verifyClaimSetServer(request);
  if (!result.ok) {
    throw new Error(`ledger.ts: synthetic claim set was rejected by the real kernel: ${result.error}`);
  }
  const verdict = result.verdict;

  const claims: LedgerClaim[] = claimsRaw.map((c, i) => ({ ...c, claim_id: verdict.submitted_claim_ids[i] }));
  const evidenceIds = Array.from(new Set(claims.flatMap((c) => c.evidence))).sort();
  const merkleTree = buildMerkleTree(evidenceIds);

  const startedAtNs = baseNs;
  const completedAtNs = baseNs + rng.int(5, 45) * 1_000_000_000;

  const manifest: Manifest = {
    investigation_id: investigationId,
    tenant_id: tenantId,
    case_id: caseId,
    epoch_root: merkleTree.root,
    epoch_id: rng.int(1, 400),
    index_snapshot_hash: syntheticHash({ investigationId, snapshot: "index" }),
    claim_set_hash: syntheticHash(claims.map((c) => c.claim_id).sort()),
    claim_ids: verdict.submitted_claim_ids,
    inference: {
      provider: rng.pick(["vllm", "anthropic", "ollama"]),
      model_id: rng.pick(["qwen2.5-32b-instruct", "mistral-small-2506", "phi-4"]),
      weights_digest: syntheticHash({ investigationId, part: "weights" }).slice(0, 32),
      seed: rng.int(1, 2 ** 31 - 1),
    },
    policy_version: verdict.policy_version,
    kernel_version: verdict.kernel_version,
    attack_model_version: "attack.v16.1",
    verdict_severity: verdict.severity as Severity,
    verdict_confidence: verdict.confidence,
    verdict_disposition: verdict.disposition as Disposition,
    verdict_hash: verdict.verdict_hash,
    budget_consumed: { tool_calls: rng.int(3, 22), turns: rng.int(1, 8) },
    started_at_ns: startedAtNs,
    completed_at_ns: completedAtNs,
    // A deliberately broken link, seeded on exactly one row, is what
    // gives docs/UI-SPEC.md's "broken-chain state rendered unmistakably"
    // something real to detect rather than an always-green happy path.
    prev_manifest_hash: makeBroken ? syntheticHash({ broken: investigationId }) : prevManifestHash,
  };

  const manifest_hash = syntheticHash(manifest);
  const sealed: SealedManifest = {
    manifest,
    manifest_hash,
    signature: syntheticHash({ sig: manifest_hash }).slice(0, 96),
    public_key: syntheticHash({ pub: tenantId }).slice(0, 64),
    chainBroken: makeBroken,
  };

  return {
    sealed,
    caseData: { investigationId, caseId, claims, merkleRoot: merkleTree.root, merkleTree, evidenceIds },
  };
}

let ledgerPromise: Promise<LedgerData> | null = null;
const globalForLedger = globalThis as unknown as { __attestaLedgerPromise?: Promise<LedgerData> };

async function buildLedger(): Promise<LedgerData> {
  const cases = listCases();
  const rng = new Xorshift32(0x1edce4);
  const policy = buildSyntheticPolicy();
  const manifests: SealedManifest[] = [];
  const caseData = new Map<string, LedgerCaseData>();

  for (const tenantId of TENANTS) {
    const tenantCases = cases.filter((c) => c.tenantId === tenantId).slice(0, MANIFESTS_PER_TENANT);
    let prevHash = ZERO_HASH;
    for (let i = 0; i < tenantCases.length; i++) {
      const c = tenantCases[i];
      const makeBroken = i === Math.floor(tenantCases.length / 2) && tenantCases.length > 3;
      const { sealed, caseData: cd } = await buildManifest(rng, tenantId, c.id, c.primaryEntity, prevHash, policy, makeBroken);
      manifests.push(sealed);
      caseData.set(cd.investigationId, cd);
      prevHash = sealed.manifest_hash;
    }
  }

  manifests.sort((a, b) => b.manifest.completed_at_ns - a.manifest.completed_at_ns);
  return { manifests, caseData, policy };
}

export function getLedgerData(): Promise<LedgerData> {
  if (globalForLedger.__attestaLedgerPromise) return globalForLedger.__attestaLedgerPromise;
  if (!ledgerPromise) ledgerPromise = buildLedger();
  globalForLedger.__attestaLedgerPromise = ledgerPromise;
  return ledgerPromise;
}

export async function proveEvidenceInclusion(investigationId: string, evidenceId: string): Promise<InclusionProof | null> {
  const { caseData } = await getLedgerData();
  const c = caseData.get(investigationId);
  if (!c) return null;
  const index = c.evidenceIds.indexOf(evidenceId);
  if (index === -1) return null;
  return proveInclusion(c.merkleTree, index);
}
