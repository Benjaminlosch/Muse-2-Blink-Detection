/**
 * Causal, sample-by-sample DSP building blocks — the TypeScript port of
 * src/bcihand/dsp/filters.py. Python is the golden reference (see
 * docs/WEB_DSP_EQUIVALENCE.md); this file must stay behaviorally identical.
 *
 * The biquad recursion here (Direct Form II Transposed) is the exact same
 * one implemented in firmware/esp32/lib/core/dsp.cpp, which was verified
 * bit-for-bit against scipy.signal.sosfilt before being ported (see that
 * file's header comment). The same verification applies here: this is not
 * an independent derivation, it's the same proven recursion.
 *
 * IMPORTANT: causal only. Nothing here looks at future samples. There is
 * no filtfilt/zero-phase equivalent in this file or anywhere in web/src —
 * unlike the Python side, the web app has no offline-only visualization
 * path that would need one.
 */
import { BANDPASS_SOS, NOTCH_SOS } from "./filterCoeffs.generated";

/** A single Direct Form II Transposed biquad section with persistent state. */
export class BiquadSection {
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  private z1 = 0;
  private z2 = 0;

  /** row: [b0, b1, b2, a0, a1, a2] (a0 is always 1.0, scipy SOS convention). */
  constructor(row: number[]) {
    this.b0 = row[0];
    this.b1 = row[1];
    this.b2 = row[2];
    this.a1 = row[4];
    this.a2 = row[5];
  }

  processSample(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/** A cascade of biquad sections (a full SOS filter). */
export class StreamingSOS {
  private readonly sections: BiquadSection[];

  constructor(sos: number[][]) {
    this.sections = sos.map((row) => new BiquadSection(row));
  }

  processSample(x: number): number {
    let y = x;
    for (const section of this.sections) {
      y = section.processSample(y);
    }
    return y;
  }

  processBlock(x: Float64Array | number[]): Float64Array {
    const out = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = this.processSample(x[i]);
    return out;
  }

  reset(): void {
    for (const section of this.sections) section.reset();
  }
}

/** Slow exponential-moving-average baseline tracker for DC/drift removal. */
export class AdaptiveBaselineTracker {
  private readonly alpha: number;
  private baselineValue = 0;
  private initialized = false;

  constructor(fsHz: number, timeConstantS: number) {
    const dt = 1 / fsHz;
    this.alpha = dt / (timeConstantS + dt);
  }

  processSample(x: number): number {
    if (!this.initialized) {
      this.baselineValue = x;
      this.initialized = true;
    } else {
      this.baselineValue = this.baselineValue + this.alpha * (x - this.baselineValue);
    }
    return x - this.baselineValue;
  }

  get baseline(): number {
    return this.baselineValue;
  }

  reset(): void {
    this.baselineValue = 0;
    this.initialized = false;
  }
}

/**
 * The full causal per-channel filter chain used in production:
 *   adaptive baseline removal -> Butterworth bandpass (SOS) -> optional 60Hz notch (SOS)
 * Mirrors dsp/filters.py's CausalBlinkBandFilter. One instance per channel.
 */
export class CausalBlinkBandFilter {
  private readonly baselineTracker: AdaptiveBaselineTracker;
  private readonly bandpass: StreamingSOS;
  private readonly notch: StreamingSOS | null;

  constructor(fsHz: number, baselineTimeConstantS: number, notchEnabled: boolean) {
    this.baselineTracker = new AdaptiveBaselineTracker(fsHz, baselineTimeConstantS);
    this.bandpass = new StreamingSOS(BANDPASS_SOS);
    this.notch = notchEnabled ? new StreamingSOS(NOTCH_SOS) : null;
  }

  processSample(x: number): number {
    let y = this.baselineTracker.processSample(x);
    y = this.bandpass.processSample(y);
    if (this.notch) y = this.notch.processSample(y);
    return y;
  }

  processBlock(x: Float64Array | number[]): Float64Array {
    const out = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = this.processSample(x[i]);
    return out;
  }

  reset(): void {
    this.baselineTracker.reset();
    this.bandpass.reset();
    this.notch?.reset();
  }
}
