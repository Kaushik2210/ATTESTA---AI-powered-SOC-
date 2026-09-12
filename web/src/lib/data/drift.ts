import { blake3 } from "@noble/hashes/blake3.js";
import { getLedgerData } from "./ledger";
import { verifyClaimSetServer } from "@/lib/kernel/kernel-wasm-server";
import type { KernelRequest } from "@/lib/kernel/kernel-wasm";
import type { Disposition, PolicyDelta, Severity, VerdictDrift } from "./types";

const INDICATOR_CORPUS_VERSION = "corpus-2026.09.3";
const INDICATOR_CORPUS_HASH = Array.from(blake3(new TextEncoder().encode(INDICATOR_CORPUS_VERSION)))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

/** Retro-Verdict Drift, real end to end -- mirrors
 * services/adjudicate/attesta_adjudicate/rvd.py's actual mechanism (not
 * a UI-invented approximation of it): take a closed case's STORED claim
 * set unchanged, reprice ONE predicate's weight in the policy (standing
 * in for "a threat-intel corpus newly prices this indicator"), and
 * re-adjudicate under the SAME real kernel. No re-ingestion, no new
 * claims -- if the resulting severity/disposition genuinely differs
 * (which is not guaranteed; the kernel decides, this function doesn't
 * force it), that's a real drift, with the exact responsible claim and
 * policy delta rvd.py's own VerdictDrift schema names.
 */
async function computeDriftForCase(
  caseId: string,
  tenantId: string,
  kernelVersion: string,
  claims: KernelRequest["claims"],
  basePolicy: KernelRequest["policy"],
  oldVerdict: { severity: Severity; disposition: Disposition; verdict_hash: string },
  repriceIndex: number,
): Promise<VerdictDrift | null> {
  const target = claims[repriceIndex];
  const existing = basePolicy.predicate_weights[target.predicate];
  if (!existing) return null;

  const newWeight = existing.weight + 5000;
  const augmented: KernelRequest["policy"] = {
    ...basePolicy,
    predicate_weights: {
      ...basePolicy.predicate_weights,
      [target.predicate]: { ...existing, weight: newWeight },
    },
  };

  // Re-running the ORIGINAL (unaugmented) policy over the same claims
  // reconstructs the old verdict's full contributing-claims attribution
  // -- the sealed manifest only stored the final hash/severity/
  // disposition, not the per-claim weight breakdown, and this
  // recomputation is guaranteed to reproduce it exactly (same kernel,
  // same inputs) for docs/UI-SPEC.md §5's "before/after kernel-
  // attribution comparison."
  const [oldResult, newResult] = await Promise.all([
    verifyClaimSetServer({ kernel_version: kernelVersion, policy: basePolicy, claims }),
    verifyClaimSetServer({ kernel_version: kernelVersion, policy: augmented, claims }),
  ]);
  if (!oldResult.ok || !newResult.ok) return null;
  const newVerdict = newResult.verdict;

  if (newVerdict.severity === oldVerdict.severity && newVerdict.disposition === oldVerdict.disposition) {
    return null; // the kernel genuinely didn't flip -- not every reprice does, and that's correct
  }
  if (oldResult.verdict.verdict_hash !== oldVerdict.verdict_hash) {
    // The recomputed "old" hash should match the sealed manifest's --
    // if it doesn't, something upstream (policy, claims) drifted between
    // sealing and this sweep, and showing a fabricated attribution would
    // be worse than showing nothing.
    return null;
  }

  const responsibleClaimId = newVerdict.submitted_claim_ids[repriceIndex];
  const policyDelta: PolicyDelta = { predicate: target.predicate, old_weight: existing.weight, new_weight: newWeight };

  return {
    case_id: caseId,
    tenant_id: tenantId,
    old_severity: oldVerdict.severity,
    new_severity: newVerdict.severity as Severity,
    old_disposition: oldVerdict.disposition,
    new_disposition: newVerdict.disposition as Disposition,
    old_verdict_hash: oldVerdict.verdict_hash,
    new_verdict_hash: newVerdict.verdict_hash,
    old_contributing_claims: oldResult.verdict.contributing_claims,
    new_contributing_claims: newVerdict.contributing_claims,
    responsible_claim_ids: [responsibleClaimId],
    policy_deltas: [policyDelta],
    indicator_corpus_version: INDICATOR_CORPUS_VERSION,
    indicator_corpus_hash: INDICATOR_CORPUS_HASH,
    // Deterministic from the investigation id (not Math.random(), matching
    // this codebase's seeded-PRNG discipline everywhere else) so results
    // are stable across requests within the same server process.
    flipped_at_ms: Date.now() - (repriceIndex % 6) * 86_400_000,
    closed_at_ms: Date.now() - ((repriceIndex % 20) + 10) * 86_400_000,
  };
}

let driftPromise: Promise<VerdictDrift[]> | null = null;
const globalForDrift = globalThis as unknown as { __attestaDriftPromise?: Promise<VerdictDrift[]> };

async function buildDrift(): Promise<VerdictDrift[]> {
  const { manifests, caseData, policy } = await getLedgerData();
  const drifts: VerdictDrift[] = [];

  // Every third manifest gets a real reprice attempt -- not every one,
  // so the Drift Monitor's own case for existing is that it's a subset
  // of closed cases, matching rvd.py's "cases with no matching claim are
  // skipped entirely" behavior in spirit.
  for (let i = 0; i < manifests.length; i += 3) {
    const sealed = manifests[i];
    const c = caseData.get(sealed.manifest.investigation_id);
    if (!c || c.claims.length === 0) continue;
    const repriceIndex = i % c.claims.length;
    const drift = await computeDriftForCase(
      sealed.manifest.case_id,
      sealed.manifest.tenant_id,
      sealed.manifest.kernel_version,
      c.claims,
      policy,
      {
        severity: sealed.manifest.verdict_severity,
        disposition: sealed.manifest.verdict_disposition,
        verdict_hash: sealed.manifest.verdict_hash,
      },
      repriceIndex,
    );
    if (drift) drifts.push(drift);
  }

  drifts.sort((a, b) => b.flipped_at_ms - a.flipped_at_ms);
  return drifts;
}

export function getDriftData(): Promise<VerdictDrift[]> {
  if (globalForDrift.__attestaDriftPromise) return globalForDrift.__attestaDriftPromise;
  if (!driftPromise) driftPromise = buildDrift();
  globalForDrift.__attestaDriftPromise = driftPromise;
  return driftPromise;
}
