"use client";

import { useState } from "react";
import { CheckCircle2, Download, FlaskConical, Loader2, XCircle } from "lucide-react";
import { motion } from "motion/react";
import type { LedgerClaim, SealedManifest } from "@/lib/data/types";
import type { KernelRequest } from "@/lib/kernel/kernel-wasm";
import { verifyClaimSet } from "@/lib/kernel/kernel-wasm";
import { verifyInclusion, type InclusionProof } from "@/lib/kernel/merkle";
import { Button } from "@/components/ui/button";

type StepStatus = "pending" | "active" | "done" | "failed";

interface Step {
  id: string;
  label: string;
  status: StepStatus;
}

const INITIAL_STEPS: Step[] = [
  { id: "fetch", label: "Fetch claim set", status: "pending" },
  { id: "evidence", label: "Verify evidence inclusion", status: "pending" },
  { id: "kernel", label: "Run kernel (WASM, in-browser)", status: "pending" },
  { id: "compare", label: "Compare verdict hash", status: "pending" },
];

async function fetchClaims(investigationId: string): Promise<{ claims: LedgerClaim[]; policy: KernelRequest["policy"]; evidenceIds: string[] }> {
  const res = await fetch(`/api/ledger/manifests/${investigationId}/claims`);
  return res.json();
}

async function fetchProof(investigationId: string, evidenceId: string): Promise<InclusionProof | null> {
  const res = await fetch(`/api/ledger/manifests/${investigationId}/evidence/${encodeURIComponent(evidenceId)}/proof`);
  if (!res.ok) return null;
  const { proof } = await res.json();
  return proof;
}

/** docs/UI-SPEC.md §4's verification panel: "The browser loads
 * attesta_kernel.wasm, fetches the claim set, recomputes the verdict
 * locally, and compares hashes. Show it happening: a short, honest
 * progress sequence (fetch claims -> verify evidence inclusion -> run
 * kernel -> compare hash) ending in a verification seal ... Keep it
 * under 900ms." Every step here is real: the claims and policy are
 * fetched from the same synthetic store the manifest was sealed
 * against, evidence inclusion is a genuine client-side BLAKE3/Merkle
 * recomputation (web/src/lib/kernel/merkle.ts), and the kernel step
 * loads and runs the actual compiled kernel/wasm_bridge output
 * (web/src/lib/kernel/kernel-wasm.ts) -- not a mocked delay.
 */
export function VerificationPanel({ sealed }: { sealed: SealedManifest }) {
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [result, setResult] = useState<"idle" | "match" | "mismatch" | "error">("idle");
  const [recomputedHash, setRecomputedHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tampered, setTampered] = useState(false);
  const [running, setRunning] = useState(false);

  function setStep(id: string, status: StepStatus) {
    setSteps((s) => s.map((step) => (step.id === id ? { ...step, status } : step)));
  }

  async function runVerification(withTamper: boolean) {
    setRunning(true);
    setResult("idle");
    setErrorMsg(null);
    setRecomputedHash(null);
    setSteps(INITIAL_STEPS);
    setTampered(withTamper);

    try {
      setStep("fetch", "active");
      const { claims, policy } = await fetchClaims(sealed.manifest.investigation_id);
      if (claims.length === 0) throw new Error("no claims returned for this investigation");
      setStep("fetch", "done");

      setStep("evidence", "active");
      const evidenceIds = Array.from(new Set(claims.flatMap((c) => c.evidence)));
      let allValid = true;
      for (const id of evidenceIds) {
        const proof = await fetchProof(sealed.manifest.investigation_id, id);
        if (!proof || !verifyInclusion(id, proof)) {
          allValid = false;
          break;
        }
      }
      if (!allValid) {
        setStep("evidence", "failed");
        setResult("mismatch");
        setErrorMsg("An evidence hash failed inclusion verification against the epoch root.");
        return;
      }
      setStep("evidence", "done");

      setStep("kernel", "active");
      const requestClaims = withTamper
        ? claims.map((c, i) => (i === 0 ? { ...c, observed_value: (c.observed_value ?? 0) + 999999 } : c))
        : claims;
      const kernelResult = await verifyClaimSet({
        kernel_version: sealed.manifest.kernel_version,
        policy,
        claims: requestClaims,
      });
      if (!kernelResult.ok) {
        setStep("kernel", "failed");
        setResult("error");
        setErrorMsg(kernelResult.error);
        return;
      }
      setStep("kernel", "done");

      setStep("compare", "active");
      setRecomputedHash(kernelResult.verdict.verdict_hash);
      const matches = kernelResult.verdict.verdict_hash === sealed.manifest.verdict_hash;
      setStep("compare", matches ? "done" : "failed");
      setResult(matches ? "match" : "mismatch");
    } catch (err) {
      setResult("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function exportBundle() {
    const bundle = {
      manifest: sealed.manifest,
      manifest_hash: sealed.manifest_hash,
      signature: sealed.signature,
      public_key: sealed.public_key,
      note: "Synthetic Phase 11 demo bundle -- see phases/reports/PHASE-11.md for what's real (kernel verification) vs. synthetic (manifest signature/chain) in this export.",
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sealed.manifest.investigation_id}-evidence-bundle.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => runVerification(false)} disabled={running} data-testid="run-verification">
          {running && !tampered ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
          Verify
        </Button>
        <Button size="sm" variant="outline" onClick={() => runVerification(true)} disabled={running} data-testid="run-tamper-demo">
          <FlaskConical className="size-3.5" aria-hidden="true" />
          Simulate tampered claim
        </Button>
        <Button size="sm" variant="outline" onClick={exportBundle} data-testid="export-bundle">
          <Download className="size-3.5" aria-hidden="true" />
          Export evidence bundle
        </Button>
      </div>

      <ul className="flex flex-col gap-1.5" data-testid="verification-steps">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2 text-xs">
            {step.status === "pending" && <span className="size-3.5 rounded-full border border-hairline" />}
            {step.status === "active" && <Loader2 className="size-3.5 animate-spin text-accent-attesta" aria-hidden="true" />}
            {step.status === "done" && <CheckCircle2 className="size-3.5 text-disposition-benign" aria-hidden="true" />}
            {step.status === "failed" && <XCircle className="size-3.5 text-severity-high" aria-hidden="true" />}
            <span className={step.status === "pending" ? "text-text-tertiary" : "text-text-primary"}>{step.label}</span>
          </li>
        ))}
      </ul>

      {result === "match" && (
        <motion.div
          data-testid="verification-seal"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 24 }}
          className="flex items-center gap-2 rounded-md border border-disposition-benign/30 bg-disposition-benign/10 px-3 py-2 text-sm text-disposition-benign"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          <div>
            <div className="font-medium">Verified</div>
            <div className="font-mono text-[11px] text-text-secondary">{recomputedHash}</div>
          </div>
        </motion.div>
      )}
      {result === "mismatch" && (
        <motion.div
          data-testid="verification-broken"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-start gap-2 rounded-md border border-severity-high/30 bg-severity-high/10 px-3 py-2 text-sm text-severity-high"
        >
          <XCircle className="size-4 shrink-0" aria-hidden="true" />
          <div>
            <div className="font-medium">{tampered ? "Verification failed (expected -- claim set was tampered)" : "Verification failed"}</div>
            {recomputedHash && (
              <div className="mt-1 font-mono text-[11px] text-text-secondary">
                stored: {sealed.manifest.verdict_hash}
                <br />
                recomputed: {recomputedHash}
              </div>
            )}
            {errorMsg && <div className="mt-1 text-text-secondary">{errorMsg}</div>}
          </div>
        </motion.div>
      )}
      {result === "error" && errorMsg && (
        <div className="rounded-md border border-severity-high/30 bg-severity-high/10 px-3 py-2 text-sm text-severity-high">{errorMsg}</div>
      )}
    </div>
  );
}
