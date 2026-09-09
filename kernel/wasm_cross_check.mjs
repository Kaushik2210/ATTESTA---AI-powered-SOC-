// Cross-target determinism check (phases/reports/PHASE-05.md): loads the
// wasm32-unknown-unknown build of the kernel, calls
// wasm_fixed_scenario_hash_u64 for every fixed scenario (see
// src/fixtures.rs), and compares against the native build's output
// (produced by src/bin/print_fixed_hashes.rs) for the identical
// scenarios. Node's WebAssembly API represents wasm i64 return values as
// BigInt (standard since Node 15+; no special flags needed on the Node
// 20 this project pins) -- that's what makes a full 64-bit exact
// comparison possible here, not a lossy float approximation.
//
// Usage: node wasm_cross_check.mjs <path-to.wasm> <path-to-native-hashes.txt>

import { readFileSync } from "node:fs";

const [, , wasmPath, nativeHashesPath] = process.argv;
if (!wasmPath || !nativeHashesPath) {
  console.error("usage: node wasm_cross_check.mjs <wasm path> <native hashes path>");
  process.exit(2);
}

const wasmBuffer = readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(wasmBuffer, {});

const exportFn = instance.exports.wasm_fixed_scenario_hash_u64;
if (typeof exportFn !== "function") {
  console.error("wasm module does not export wasm_fixed_scenario_hash_u64 -- check it compiled with --target wasm32-unknown-unknown");
  process.exit(2);
}

const nativeLines = readFileSync(nativeHashesPath, "utf8").trim().split("\n").filter(Boolean);

let mismatches = 0;
for (const line of nativeLines) {
  const [indexStr, nativeHex] = line.trim().split(/\s+/);
  const index = Number(indexStr);
  // BigInt, per the WebAssembly/JS BigInt integration -- but wasm's i64
  // type carries no signedness of its own, and Node decodes it as a
  // SIGNED 64-bit BigInt by convention. The Rust side returns u64, so any
  // hash whose top bit is set comes back as a negative BigInt here even
  // though nothing about the underlying value differs. asUintN
  // reinterprets the same 64 bits as unsigned before formatting, which is
  // what actually matches Rust's `{:016x}` (u64) formatting on the native
  // side -- this is a JS-side interpretation fix, not evidence of any
  // real cross-target difference (see phases/reports/PHASE-05.md).
  const wasmResult = BigInt.asUintN(64, exportFn(index));
  const wasmHex = wasmResult.toString(16).padStart(16, "0");
  if (wasmHex !== nativeHex) {
    console.error(`MISMATCH scenario ${index}: native=${nativeHex} wasm=${wasmHex}`);
    mismatches++;
  } else {
    console.log(`OK scenario ${index}: ${wasmHex}`);
  }
}

if (mismatches > 0) {
  console.error(`${mismatches} mismatch(es) between native and wasm32 kernel execution`);
  process.exit(1);
}
if (nativeLines.length === 0) {
  console.error("no native hashes to compare against -- empty input file");
  process.exit(2);
}
console.log(`native and wasm32 kernel execution match exactly for all ${nativeLines.length} fixed scenarios`);
