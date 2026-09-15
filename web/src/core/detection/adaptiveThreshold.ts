/**
 * Robust, adaptive amplitude threshold — port of detection/adaptive_threshold.py.
 * Median/MAD rather than mean/std: robust to the very outliers we're
 * thresholding against.
 */

export const MAD_TO_SIGMA = 1.4826;

/** Matches numpy.median exactly: average of the two middle elements for an
 * even-length array (numpy does NOT use nearest-rank / "lower" median). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function medianAbsoluteDeviation(values: number[], med: number): number {
  const deviations = values.map((v) => Math.abs(v - med));
  return median(deviations);
}

/** Fixed-capacity FIFO buffer, mirroring Python's collections.deque(maxlen=...). */
export class RingBuffer {
  private buf: number[] = [];
  private readonly maxLen: number;

  constructor(maxLen: number) {
    this.maxLen = maxLen;
  }

  push(value: number): void {
    this.buf.push(value);
    if (this.buf.length > this.maxLen) this.buf.shift();
  }

  get values(): number[] {
    return this.buf;
  }

  get length(): number {
    return this.buf.length;
  }
}

export class AdaptiveThreshold {
  private readonly buffer: RingBuffer;
  private readonly madMultiplier: number;
  private readonly updateIntervalSamples: number;
  private readonly minThreshold: number;
  private samplesSinceUpdate = 0;
  private medianValue = 0;
  private madValue = 0;
  private thresholdValue: number;

  constructor(fsHz: number, windowS = 10.0, madMultiplier = 4.0, updateIntervalSamples = 32, minThreshold = 1e-6) {
    this.madMultiplier = madMultiplier;
    this.updateIntervalSamples = updateIntervalSamples;
    this.minThreshold = minThreshold;
    const maxLen = Math.max(Math.floor(windowS * fsHz), 8);
    this.buffer = new RingBuffer(maxLen);
    this.thresholdValue = minThreshold;
  }

  /** Feed one (rectified/abs) filtered sample; returns the current threshold. */
  update(absSampleValue: number, inCandidate = false): number {
    if (!inCandidate) {
      this.buffer.push(absSampleValue);
      this.samplesSinceUpdate += 1;
    }

    if (this.samplesSinceUpdate >= this.updateIntervalSamples && this.buffer.length >= 8) {
      const values = this.buffer.values;
      this.medianValue = median(values);
      this.madValue = medianAbsoluteDeviation(values, this.medianValue);
      this.thresholdValue = Math.max(
        this.medianValue + this.madMultiplier * MAD_TO_SIGMA * this.madValue,
        this.minThreshold,
      );
      this.samplesSinceUpdate = 0;
    }

    return this.thresholdValue;
  }

  get threshold(): number {
    return this.thresholdValue;
  }

  get noiseFloorMedian(): number {
    return this.medianValue;
  }

  get noiseFloorMad(): number {
    return this.madValue;
  }

  /** Bulk-seed the buffer (used right after calibration) so the threshold
   * is meaningful immediately instead of ramping up from zero. */
  seed(samples: Float64Array | number[]): void {
    for (const s of samples) this.buffer.push(Math.abs(s));
    this.samplesSinceUpdate = this.updateIntervalSamples;
    this.update(0, true);
  }
}
