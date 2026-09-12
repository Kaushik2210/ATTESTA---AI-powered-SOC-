/**
 * Loader for kernel/wasm_bridge's compiled output -- the browser side of
 * the Verdict Ledger's client-side verification panel
 * (docs/UI-SPEC.md §4: "The browser loads `attesta_kernel.wasm`,
 * fetches the claim set, recomputes the verdict locally, and compares
 * hashes"). Served at /kernel-verify.wasm, built by CI from
 * kernel/wasm_bridge/ (see .github/workflows/ci.yml's web-ui-gate job
 * and web/.gitignore) -- this file never re-implements adjudication
 * logic itself, only the manual memory ABI kernel/wasm_bridge/src/lib.rs
 * documents: wasm_alloc/wasm_dealloc to hand request bytes across the
 * boundary, wasm_adjudicate to run the real kernel, wasm_result_ptr/
 * wasm_result_len to read the response back. No wasm-bindgen, matching
 * the project's existing raw-ABI convention from kernel/'s own
 * wasm32-unknown-unknown build (kernel/wasm_cross_check.mjs).
 */

export interface KernelRequest {
  kernel_version: string;
  policy: {
    policy_version: string;
    predicate_weights: Record<string, { tactic: string; weight: number; techniques?: string[] }>;
    chain_multipliers?: { from: string; to: string; bonus: number }[];
    severity_thresholds: [number, string][];
  };
  claims: {
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
  }[];
}

export interface KernelContributingClaim {
  claim_id: string;
  predicate: string;
  attributed_weight: number;
}

export interface KernelVerdict {
  severity: string;
  confidence: number;
  disposition: string;
  attack_techniques: string[];
  contributing_claims: KernelContributingClaim[];
  policy_version: string;
  kernel_version: string;
  verdict_hash: string;
  submitted_claim_ids: string[];
}

export type KernelResult = { ok: true; verdict: KernelVerdict } | { ok: false; error: string };

interface KernelExports {
  memory: WebAssembly.Memory;
  wasm_alloc: (len: number) => number;
  wasm_dealloc: (ptr: number, len: number) => void;
  wasm_adjudicate: (ptr: number, len: number) => number;
  wasm_result_ptr: () => number;
  wasm_result_len: () => number;
}

let instancePromise: Promise<KernelExports> | null = null;

/** Fetches and instantiates /kernel-verify.wasm once; cached for reuse
 * across every verification the Verdict Ledger panel runs in a session. */
async function getInstance(): Promise<KernelExports> {
  if (!instancePromise) {
    instancePromise = (async () => {
      const res = await fetch("/kernel-verify.wasm");
      if (!res.ok) {
        throw new Error(`fetching /kernel-verify.wasm: HTTP ${res.status}`);
      }
      const bytes = await res.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      return instance.exports as unknown as KernelExports;
    })();
  }
  return instancePromise;
}

/** Runs the real kernel, in-browser, against `request` -- the exact
 * computation `kernel/src/lib.rs::adjudicate` performs natively, reached
 * here via kernel/wasm_bridge's JSON ABI rather than a subprocess. Never
 * fabricates a result: a wasm-side parse/validation failure surfaces as
 * `{ok: false}`, and a fetch/instantiate failure (e.g. the .wasm file
 * missing) throws rather than silently returning a fake verdict.
 */
export async function verifyClaimSet(request: KernelRequest): Promise<KernelResult> {
  const kernel = await getInstance();
  const requestBytes = new TextEncoder().encode(JSON.stringify(request));

  const ptr = kernel.wasm_alloc(requestBytes.length);
  try {
    new Uint8Array(kernel.memory.buffer, ptr, requestBytes.length).set(requestBytes);
    const ok = kernel.wasm_adjudicate(ptr, requestBytes.length);
    if (ok !== 1) {
      throw new Error("kernel-verify.wasm: request bytes were not valid UTF-8");
    }

    const resultPtr = kernel.wasm_result_ptr();
    const resultLen = kernel.wasm_result_len();
    // Copy out of wasm memory before decoding -- kernel.memory.buffer can
    // be detached/resized by a later allocation, and TextDecoder over a
    // live view into it would then read from a stale or invalid region.
    const resultBytes = new Uint8Array(kernel.memory.buffer, resultPtr, resultLen).slice();
    const parsed = JSON.parse(new TextDecoder().decode(resultBytes)) as KernelVerdict | { error: string };

    if ("error" in parsed) {
      return { ok: false, error: parsed.error };
    }
    return { ok: true, verdict: parsed };
  } finally {
    kernel.wasm_dealloc(ptr, requestBytes.length);
  }
}
