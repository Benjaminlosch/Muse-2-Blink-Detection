/**
 * Lightweight, streaming signal-quality indicators — port of
 * detection/signal_quality.py.
 */
import type { SignalQualityStatus } from "../types";
import { RingBuffer } from "./adaptiveThreshold";

export class SignalQualityMonitor {
  private readonly buf: RingBuffer;
  private readonly maxLen: number;
  private readonly flatlineStdUv: number;
  private readonly railedAbsUv: number;
  private readonly excessiveNoiseStdUv: number;

  constructor(fsHz: number, windowS = 1.0, flatlineStdUv = 0.05, railedAbsUv = 400.0, excessiveNoiseStdUv = 150.0) {
    this.flatlineStdUv = flatlineStdUv;
    this.railedAbsUv = railedAbsUv;
    this.excessiveNoiseStdUv = excessiveNoiseStdUv;
    this.maxLen = Math.max(Math.floor(windowS * fsHz), 4);
    this.buf = new RingBuffer(this.maxLen);
  }

  update(rawSampleUv: number): SignalQualityStatus {
    this.buf.push(rawSampleUv);
    if (this.buf.length < this.maxLen) {
      return { quality: 0.5, flatline: false, railed: false, excessiveNoise: false };
    }

    const values = this.buf.values;
    const m = values.reduce((a, b) => a + b, 0) / values.length;
    let sumSq = 0;
    let maxAbs = 0;
    for (const v of values) {
      sumSq += (v - m) ** 2;
      if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    }
    const std = Math.sqrt(sumSq / values.length);

    const flatline = std < this.flatlineStdUv;
    const railed = maxAbs > this.railedAbsUv;
    const excessiveNoise = std > this.excessiveNoiseStdUv;

    let quality: number;
    if (flatline || railed) quality = 0.0;
    else if (excessiveNoise) quality = 0.2;
    else quality = 1.0;

    return { quality, flatline, railed, excessiveNoise };
  }
}
