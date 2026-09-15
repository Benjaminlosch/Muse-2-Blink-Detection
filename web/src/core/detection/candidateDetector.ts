/**
 * Causal streaming blink-candidate detector — port of
 * detection/candidate_detector.py. See that file's module docstring for the
 * full rationale (BELOW_THRESHOLD -> ABOVE_THRESHOLD -> REFRACTORY state
 * machine, zero-crossing candidate boundaries, and filter-rebound
 * rejection). This port preserves that logic exactly; nothing here is a
 * fresh design.
 */
import type { BlinkCandidate, PeakSign } from "../types";
import { AdaptiveThreshold } from "./adaptiveThreshold";

type DetectorState = "BELOW_THRESHOLD" | "ABOVE_THRESHOLD" | "REFRACTORY";

export interface CandidateDetectorOptions {
  fsHz: number;
  minBlinkWidthS?: number;
  maxBlinkWidthS?: number;
  refractoryAfterCandidateS?: number;
  releaseRatio?: number;
  thresholdWindowS?: number;
  thresholdMadMultiplier?: number;
  reboundGuardS?: number;
  reboundRefractoryS?: number;
}

function argmaxAbs(values: number[]): number {
  let bestIdx = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = Math.abs(values[i]);
    if (v > bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export class CandidateDetector {
  readonly fsHz: number;
  private readonly dt: number;
  private readonly minWidthSamples: number;
  private readonly maxWidthSamples: number;
  private readonly refractorySamples: number;
  private readonly releaseRatio: number;
  private readonly reboundGuardS: number;
  private readonly reboundRefractorySamples: number;
  readonly threshold: AdaptiveThreshold;

  private state: DetectorState = "BELOW_THRESHOLD";
  private sampleIdx = -1;
  private eventStartIdx: number | null = null;
  private eventSign: PeakSign = 1;
  private refractoryRemaining = 0;
  private pendingExtendedWait = false;

  private lastAcceptedEndTimeS: number | null = null;
  private lastAcceptedPeakSign: PeakSign | null = null;

  private eventFrontal: number[] = [];
  private eventAf7: number[] = [];
  private eventAf8: number[] = [];

  constructor(options: CandidateDetectorOptions) {
    this.fsHz = options.fsHz;
    this.dt = 1 / options.fsHz;
    const minBlinkWidthS = options.minBlinkWidthS ?? 0.06;
    const maxBlinkWidthS = options.maxBlinkWidthS ?? 0.4;
    this.minWidthSamples = Math.max(Math.floor(minBlinkWidthS * options.fsHz), 1);
    this.maxWidthSamples = Math.max(Math.floor(maxBlinkWidthS * options.fsHz), this.minWidthSamples + 1);
    this.refractorySamples = Math.floor((options.refractoryAfterCandidateS ?? 0.15) * options.fsHz);
    this.releaseRatio = options.releaseRatio ?? 0.35;
    this.reboundGuardS = options.reboundGuardS ?? 0.3;
    this.reboundRefractorySamples = Math.max(Math.floor((options.reboundRefractoryS ?? 0.02) * options.fsHz), 1);

    this.threshold = new AdaptiveThreshold(
      options.fsHz,
      options.thresholdWindowS ?? 10.0,
      options.thresholdMadMultiplier ?? 4.0,
    );
  }

  processSample(frontal: number, af7: number, af8: number): BlinkCandidate | null {
    this.sampleIdx += 1;
    const idx = this.sampleIdx;

    const inCandidate = this.state === "ABOVE_THRESHOLD";
    const thr = this.threshold.update(Math.abs(frontal), inCandidate);

    let candidate: BlinkCandidate | null = null;

    if (this.state === "REFRACTORY") {
      this.refractoryRemaining -= 1;
      if (this.refractoryRemaining <= 0) {
        if (this.pendingExtendedWait) {
          if (Math.abs(frontal) < this.releaseRatio * thr) {
            this.state = "BELOW_THRESHOLD";
            this.pendingExtendedWait = false;
          } else {
            this.refractoryRemaining = 1;
          }
        } else {
          this.state = "BELOW_THRESHOLD";
        }
      }
      return null;
    }

    if (this.state === "BELOW_THRESHOLD") {
      if (Math.abs(frontal) >= thr) {
        this.state = "ABOVE_THRESHOLD";
        this.eventStartIdx = idx;
        this.eventSign = frontal >= 0 ? 1 : -1;
        this.eventFrontal = [frontal];
        this.eventAf7 = [af7];
        this.eventAf8 = [af8];
      }
    } else if (this.state === "ABOVE_THRESHOLD") {
      this.eventFrontal.push(frontal);
      this.eventAf7.push(af7);
      this.eventAf8.push(af8);
      const width = idx - (this.eventStartIdx as number) + 1;

      const crossedZero = frontal * this.eventSign < 0;
      const magnitudeReleased = Math.abs(frontal) < this.releaseRatio * thr;
      const tooLong = width >= this.maxWidthSamples;

      if (crossedZero || magnitudeReleased || tooLong) {
        const truncated = tooLong && !(crossedZero || magnitudeReleased);
        candidate = this.emitCandidate(thr, truncated);
        this.state = "REFRACTORY";
        this.refractoryRemaining = candidate.likelyFilterRebound
          ? this.reboundRefractorySamples
          : this.refractorySamples;
        this.pendingExtendedWait = truncated;
      }
    }

    return candidate;
  }

  private emitCandidate(thresholdAtDetection: number, truncated: boolean): BlinkCandidate {
    const startIdx = this.eventStartIdx as number;
    const endIdx = startIdx + this.eventFrontal.length - 1;
    const endTimeS = endIdx * this.dt;
    const durationS = (this.eventFrontal.length - 1) * this.dt;

    const frontalArr = new Float64Array(this.eventFrontal);
    const peakIdx = argmaxAbs(this.eventFrontal);
    const peakSign: PeakSign = frontalArr[peakIdx] >= 0 ? 1 : -1;

    const widthValid =
      !truncated && this.eventFrontal.length >= this.minWidthSamples && this.eventFrontal.length <= this.maxWidthSamples;

    let likelyFilterRebound = false;
    if (
      this.lastAcceptedEndTimeS !== null &&
      this.lastAcceptedPeakSign !== null &&
      peakSign !== this.lastAcceptedPeakSign &&
      startIdx * this.dt - this.lastAcceptedEndTimeS <= this.reboundGuardS
    ) {
      likelyFilterRebound = true;
    }

    if (widthValid && !likelyFilterRebound) {
      this.lastAcceptedEndTimeS = endTimeS;
      this.lastAcceptedPeakSign = peakSign;
    }

    return {
      startIdx,
      endIdx,
      startTimeS: startIdx * this.dt,
      endTimeS,
      durationS,
      frontalWindow: frontalArr,
      af7Window: new Float64Array(this.eventAf7),
      af8Window: new Float64Array(this.eventAf8),
      thresholdAtDetection,
      widthValid,
      peakSign,
      likelyFilterRebound,
    };
  }

  reset(): void {
    this.state = "BELOW_THRESHOLD";
    this.eventStartIdx = null;
    this.refractoryRemaining = 0;
    this.pendingExtendedWait = false;
    this.lastAcceptedEndTimeS = null;
    this.lastAcceptedPeakSign = null;
  }
}
