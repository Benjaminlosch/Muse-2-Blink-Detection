/**
 * A small seeded PRNG for the browser simulator (simulation/signalGenerator.ts).
 *
 * This does NOT need to match NumPy's PCG64 bit-for-bit — the pipeline
 * equivalence tests (core/pipeline.test.ts) replay raw samples exported
 * directly from Python rather than regenerating them in JS (see
 * docs/WEB_DSP_EQUIVALENCE.md), specifically so this simulator's RNG choice
 * has zero bearing on correctness. This is only for interactive/demo
 * "Simulation Mode" in the UI, where only a plausible, deterministic (for a
 * given seed) signal is needed.
 */

/** mulberry32 — fast, small, decent statistical quality for this use case. */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  uniform(lo = 0, hi = 1): number {
    return lo + this.next() * (hi - lo);
  }

  choice<T>(options: T[]): T {
    return options[Math.floor(this.next() * options.length)];
  }

  private spareNormal: number | null = null;

  /** Standard normal via Box-Muller, mean/std scaled. */
  normal(mean = 0, std = 1): number {
    if (this.spareNormal !== null) {
      const z = this.spareNormal;
      this.spareNormal = null;
      return mean + std * z;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    const z0 = mag * Math.cos(2.0 * Math.PI * v);
    const z1 = mag * Math.sin(2.0 * Math.PI * v);
    this.spareNormal = z1;
    return mean + std * z0;
  }
}
