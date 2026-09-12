import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { KernelRequest, KernelResult, KernelVerdict } from "./kernel-wasm";

/**
 * Server-side counterpart of kernel-wasm.ts's `verifyClaimSet` -- same
 * ABI, same /public/kernel-verify.wasm artifact, but loaded via
 * `fs.readFileSync` (Node has no `fetch` against a relative static
 * path) instead of `fetch`. Used by the synthetic data layer
 * (lib/data/ledger.ts) to seal each synthetic manifest's verdict by
 * actually running the real kernel once at store-init time -- not by
 * fabricating a plausible-looking hash -- so that later, when the
 * Verdict Ledger UI recomputes client-side and compares, it is
 * genuinely comparing two independent runs of the identical kernel
 * logic, the same way a real seal-then-verify round trip would.
 */

interface KernelExports {
  memory: WebAssembly.Memory;
  wasm_alloc: (len: number) => number;
  wasm_dealloc: (ptr: number, len: number) => void;
  wasm_adjudicate: (ptr: number, len: number) => number;
  wasm_result_ptr: () => number;
  wasm_result_len: () => number;
}

let instancePromise: Promise<KernelExports> | null = null;

async function getInstance(): Promise<KernelExports> {
  if (!instancePromise) {
    instancePromise = (async () => {
      const wasmPath = path.join(process.cwd(), "public", "kernel-verify.wasm");
      const bytes = readFileSync(wasmPath);
      const { instance } = await WebAssembly.instantiate(bytes, {});
      return instance.exports as unknown as KernelExports;
    })();
  }
  return instancePromise;
}

export async function verifyClaimSetServer(request: KernelRequest): Promise<KernelResult> {
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
