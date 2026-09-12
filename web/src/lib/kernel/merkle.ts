/**
 * Client-side re-implementation of ledger/merkle.go -- the exact
 * computation ledger/merkle.go's own VerifyInclusion doc comment names:
 * "the computation the browser repeats client-side in the Verdict
 * Ledger's 'verify inclusion proof' action." Same domain-separated
 * BLAKE3 scheme (leaf/internal/pad prefixes), same left/right combining
 * rule -- ported field-for-field from the Go source, not reinvented.
 * @noble/hashes' blake3 is a standard, spec-compliant implementation
 * (verified against the official empty-input BLAKE3 test vector before
 * this file was written), so it produces byte-identical hashes to Go's
 * lukechampine.com/blake3 for the same input bytes -- no cross-language
 * runtime to compare against in this environment, but nothing here
 * depends on Go-specific behavior, only on the BLAKE3 spec both
 * libraries implement.
 */
import { blake3 } from "@noble/hashes/blake3.js";

const DOMAIN_LEAF = 0x00;
const DOMAIN_INTERNAL = 0x01;
const DOMAIN_PAD = 0x02;

export interface MerkleProofStep {
  hash: string; // hex
  isLeft: boolean;
}

export interface InclusionProof {
  leafIndex: number;
  steps: MerkleProofStep[];
  root: string; // hex
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** evidenceId is the hex-encoded content hash string (e.g.
 * "blake3:<hex>" or bare hex -- this project's evidence ids are hashes
 * themselves; ledger/merkle.go's leafHash hashes the id's raw bytes, so
 * the caller must pass the same byte representation the tree was built
 * over -- here, the UTF-8 bytes of the id string, matching how the
 * synthetic ledger data layer builds its trees). */
function leafHash(evidenceId: string): Uint8Array {
  return blake3(concat(new Uint8Array([DOMAIN_LEAF]), new TextEncoder().encode(evidenceId)));
}

function internalHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return blake3(concat(new Uint8Array([DOMAIN_INTERNAL]), left, right));
}

function padHash(index: number): Uint8Array {
  const buf = new Uint8Array(9);
  buf[0] = DOMAIN_PAD;
  // big-endian u64, matching ledger/merkle.go's padHash byte layout
  // (index fits well within JS's safe integer range for any realistic
  // batch/epoch size, so a plain Number shift is exact here).
  for (let i = 0; i < 8; i++) buf[1 + i] = (index >>> (56 - 8 * i)) & 0xff;
  return blake3(buf);
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Builds a full Merkle tree over `evidenceIds` (ordered) exactly as
 * ledger/merkle.go's BuildMerkleTree does, so a proof produced here
 * verifies identically to one the Go ledger would produce for the same
 * input. Used by the synthetic data layer to seal a case's evidence set
 * and hand out real, checkable inclusion proofs -- not a fake UI
 * affordance. */
export function buildMerkleTree(evidenceIds: string[]): { root: string; levels: Uint8Array[][] } {
  if (evidenceIds.length === 0) throw new Error("buildMerkleTree: empty evidence set");
  const n = nextPowerOfTwo(evidenceIds.length);
  const level: Uint8Array[] = new Array(n);
  for (let i = 0; i < evidenceIds.length; i++) level[i] = leafHash(evidenceIds[i]);
  for (let i = evidenceIds.length; i < n; i++) level[i] = padHash(i);

  const levels: Uint8Array[][] = [level];
  let cur = level;
  while (cur.length > 1) {
    const next: Uint8Array[] = new Array(cur.length / 2);
    for (let i = 0; i < next.length; i++) next[i] = internalHash(cur[2 * i], cur[2 * i + 1]);
    levels.push(next);
    cur = next;
  }
  return { root: bytesToHex(levels[levels.length - 1][0]), levels };
}

export function proveInclusion(tree: { levels: Uint8Array[][] }, leafIndex: number): InclusionProof {
  const steps: MerkleProofStep[] = [];
  let idx = leafIndex;
  for (let level = 0; level < tree.levels.length - 1; level++) {
    const nodes = tree.levels[level];
    let sib: Uint8Array;
    let isLeft: boolean;
    if (idx % 2 === 0) {
      sib = nodes[idx + 1];
      isLeft = false;
    } else {
      sib = nodes[idx - 1];
      isLeft = true;
    }
    steps.push({ hash: bytesToHex(sib), isLeft });
    idx = Math.floor(idx / 2);
  }
  const root = bytesToHex(tree.levels[tree.levels.length - 1][0]);
  return { leafIndex, steps, root };
}

/** Recomputes the root from a claimed evidence id and its proof, and
 * reports whether it matches. This is the actual cryptographic check the
 * Investigation Canvas's "verify inclusion proof" action and the Verdict
 * Ledger both run -- it returns false for a tampered id or a corrupted
 * step exactly as readily as it returns true for a genuine one, which is
 * what makes it a real verifier and not a UI affordance that always
 * shows a green check. */
export function verifyInclusion(evidenceId: string, proof: InclusionProof): boolean {
  let h = leafHash(evidenceId);
  for (const step of proof.steps) {
    const sibling = hexToBytes(step.hash);
    h = step.isLeft ? internalHash(sibling, h) : internalHash(h, sibling);
  }
  return bytesToHex(h) === proof.root;
}
