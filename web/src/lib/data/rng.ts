/** A small, seeded, deterministic PRNG -- xorshift32, the same family of
 * generator the kernel's own property tests use (kernel/tests/determinism.rs's
 * hand-rolled xorshift64*), kept here for the same reason: reproducible
 * synthetic data across server restarts without pulling in a dependency
 * for it.
 */
export class Xorshift32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0 || 0xdeadbeef;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    return (x >>> 0) / 0xffffffff;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  pickN<T>(items: readonly T[], n: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    for (let i = 0; i < n && pool.length > 0; i++) {
      const idx = this.int(0, pool.length - 1);
      out.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return out;
  }

  bool(pTrue = 0.5): boolean {
    return this.next() < pTrue;
  }
}
