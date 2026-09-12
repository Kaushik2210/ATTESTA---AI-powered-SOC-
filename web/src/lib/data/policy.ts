import type { KernelRequest } from "@/lib/kernel/kernel-wasm";
import { PREDICATES_BY_TACTIC } from "./seed";
import { TACTICS } from "./types";

/** The single synthetic policy bundle every ledger manifest, drift row,
 * and canvas claim is adjudicated under in this phase -- the shape
 * kernel/wasm_bridge's ABI expects verbatim (kernel/src/policy.rs's
 * PolicyBundle, via kernel/src/bin/adjudicate_cli.rs's JSON mapping).
 * Weights are plausible but hand-picked, not derived from any real
 * detection-rate data (that's Phase 3/4 territory); what matters here is
 * that they're a genuinely valid PolicyBundle the real kernel accepts
 * and scores deterministically, not that the numbers are calibrated.
 */
export const POLICY_VERSION = "policy-2026.09.0";

const TECHNIQUE_BY_PREDICATE: Record<string, string[]> = {
  AUTH_FAILED_BURST: ["T1110"],
  AUTH_FROM_NEW_ASN: ["T1078"],
  INTERPRETER_SPAWNED_BY: ["T1059"],
  ENCODED_COMMAND: ["T1027", "T1059.001"],
  PERSISTENCE_REGISTRY_RUN_KEY: ["T1547.001"],
  PRIVILEGE_ESCALATION_ATTEMPT: ["T1068"],
  DEFENSE_EVASION_ATTEMPT: ["T1562"],
  AUTH_SUCCEEDED_AFTER_FAILURES: ["T1110"],
  TOKEN_REPLAYED: ["T1550"],
  RDP_INTERNAL_FIRST_TIME: ["T1021.001"],
  LATERAL_MOVEMENT_DETECTED: ["T1021"],
  DATA_STAGING_DETECTED: ["T1074"],
  INTERPRETER_NETWORK_EGRESS: ["T1071"],
  CONNECTED_TO_INDICATOR: ["T1071"],
  DATA_EXFILTRATED: ["T1041"],
  IMPACT_DETECTED: ["T1485"],
};

export function buildSyntheticPolicy(): KernelRequest["policy"] {
  const predicate_weights: KernelRequest["policy"]["predicate_weights"] = {};
  for (const tactic of TACTICS) {
    const predicates = PREDICATES_BY_TACTIC[tactic] ?? [];
    for (const predicate of predicates) {
      predicate_weights[predicate] = {
        tactic,
        weight: 1200 + (predicate.length % 5) * 300,
        techniques: TECHNIQUE_BY_PREDICATE[predicate] ?? [],
      };
    }
  }

  return {
    policy_version: POLICY_VERSION,
    predicate_weights,
    chain_multipliers: [
      { from: "initial-access", to: "execution", bonus: 500 },
      { from: "execution", to: "persistence", bonus: 400 },
      { from: "credential-access", to: "lateral-movement", bonus: 600 },
      { from: "collection", to: "exfiltration", bonus: 700 },
      { from: "command-and-control", to: "exfiltration", bonus: 500 },
    ],
    severity_thresholds: [
      [0, "info"],
      [1500, "low"],
      [3500, "medium"],
      [6000, "high"],
      [8500, "critical"],
    ],
  };
}
