/**
 * Latency instrumentation — port of utils/latency.py, used by the
 * Diagnostics page (project brief section 24) to report worker/filter/
 * candidate-detector/classifier/total blink-to-command latency.
 */

export interface LatencyStats {
  n: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export class LatencyProfiler {
  private readonly durationsS = new Map<string, number[]>();

  record(stage: string, durationS: number): void {
    const arr = this.durationsS.get(stage) ?? [];
    arr.push(durationS);
    if (arr.length > 2000) arr.shift(); // bound memory for long-running sessions
    this.durationsS.set(stage, arr);
  }

  recordTotal(durationS: number): void {
    this.record("total_signal_to_command", durationS);
  }

  summary(): Record<string, LatencyStats> {
    const out: Record<string, LatencyStats> = {};
    for (const [stage, values] of this.durationsS) {
      if (values.length === 0) continue;
      const ms = values.map((v) => v * 1000);
      const sorted = [...ms].sort((a, b) => a - b);
      const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
      const median = sorted[Math.floor(sorted.length / 2)];
      const p95 = sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)];
      const max = sorted[sorted.length - 1];
      out[stage] = { n: values.length, meanMs: mean, medianMs: median, p95Ms: p95, maxMs: max };
    }
    return out;
  }
}
