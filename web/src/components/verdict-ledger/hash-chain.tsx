"use client";

import { AlertTriangle, Link2 } from "lucide-react";
import type { SealedManifest } from "@/lib/data/types";

function short(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** docs/UI-SPEC.md §4: "Show the hash chain visually: prev_manifest_hash
 * -> manifest_hash, with a broken-chain state rendered unmistakably if
 * verification ever fails." `chainBroken` is seeded on exactly one row
 * per tenant in the synthetic ledger (lib/data/ledger.ts) precisely so
 * this state has something real to detect and render, rather than an
 * always-green happy path nobody ever sees fail.
 */
export function HashChain({ sealed }: { sealed: SealedManifest }) {
  const broken = sealed.chainBroken === true;
  return (
    <div
      data-testid={broken ? "hash-chain-broken" : "hash-chain-ok"}
      className={`flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-[11px] ${
        broken ? "border-severity-high/40 bg-severity-high/10 text-severity-high" : "border-hairline bg-surface-1 text-text-secondary"
      }`}
    >
      {broken ? <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" /> : <Link2 className="size-3.5 shrink-0" aria-hidden="true" />}
      <span>{short(sealed.manifest.prev_manifest_hash)}</span>
      <span aria-hidden="true">→</span>
      <span>{short(sealed.manifest_hash)}</span>
      {broken && <span className="ml-1 font-sans font-medium">chain broken</span>}
    </div>
  );
}
