//! Prints the fixed scenarios' verdict_hash prefixes (see
//! src/fixtures.rs), one per line as "<index> <16-hex-digit-u64>". Used
//! two ways in CI (phases/reports/PHASE-05.md): comparing this native
//! build's output across the x86_64/arm64 matrix legs (cross-
//! architecture determinism), and comparing it against the wasm32 build's
//! output via kernel/wasm_cross_check.mjs (cross-target determinism).
fn main() {
    for i in 0..attesta_kernel::fixtures::FIXED_SCENARIO_COUNT {
        let hash = attesta_kernel::fixtures::fixed_scenario_hash_u64(i)
            .unwrap_or_else(|| panic!("scenario {i} should always resolve — see fixtures::FIXED_SCENARIO_COUNT"));
        println!("{i} {hash:016x}");
    }
}
