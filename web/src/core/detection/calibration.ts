/**
 * Calibration — port of detection/calibration.py. See docs/CALIBRATION.md
 * for the full rationale, including two correctness fixes carried over
 * from the Python side (do not regress these here):
 *   1. Filter-rebound candidates are excluded from calibration stats, and
 *      only the top-N-by-amplitude candidate(s) per trial are kept (one for
 *      SINGLE_BLINK, two for DOUBLE_BLINK) — otherwise residual filter
 *      ringing gets pooled into the stats and drags the median down.
 *   2. min_relative_prominence_spread defaults to 0.5 (50% of the
 *      calibrated median), not a tight value — a double blink's second
 *      pulse measures a legitimately lower prominence than an isolated
 *      blink (it rides on the first pulse's still-decaying filter tail),
 *      and a tight floor derived from a low-variance calibration session
 *      can reject it.
 */
import type { CalibrationStats } from "../types";
import { defaultCalibrationStats } from "../types";
import type { BciConfig, DeepPartial } from "../config";
import { MAD_TO_SIGMA, median, medianAbsoluteDeviation } from "./adaptiveThreshold";
import { CandidateDetector } from "./candidateDetector";
import type { BlinkCandidate } from "../types";

function medianMad(values: number[]): [number, number] {
  if (values.length === 0) return [0, 0];
  const med = median(values);
  return [med, medianAbsoluteDeviation(values, med)];
}

export interface TrialSegment {
  label: "REST" | "SINGLE_BLINK" | "DOUBLE_BLINK";
  frontal: Float64Array;
  af7: Float64Array;
  af8: Float64Array;
}

function peakUv(c: BlinkCandidate): number {
  let m = 0;
  for (let i = 0; i < c.frontalWindow.length; i++) m = Math.max(m, Math.abs(c.frontalWindow[i]));
  return m;
}

function findCandidatesInSegment(seg: TrialSegment, fsHz: number): BlinkCandidate[] {
  const detector = new CandidateDetector({ fsHz, thresholdWindowS: Math.max(seg.frontal.length / fsHz, 1.0) });
  const out: BlinkCandidate[] = [];
  for (let i = 0; i < seg.frontal.length; i++) {
    const cand = detector.processSample(seg.frontal[i], seg.af7[i], seg.af8[i]);
    if (cand !== null && cand.widthValid && !cand.likelyFilterRebound) out.push(cand);
  }
  return out;
}

export function computeCalibrationStats(segments: TrialSegment[], fsHz: number): CalibrationStats {
  const stats = defaultCalibrationStats();

  const restValues: number[] = [];
  for (const seg of segments) {
    if (seg.label === "REST") {
      for (let i = 0; i < seg.frontal.length; i++) restValues.push(Math.abs(seg.frontal[i]));
      stats.nRestTrials += 1;
    } else if (seg.label === "SINGLE_BLINK") {
      stats.nSingleTrials += 1;
    } else if (seg.label === "DOUBLE_BLINK") {
      stats.nDoubleTrials += 1;
    }
  }
  [stats.baselineMedian, stats.baselineMad] = medianMad(restValues);
  stats.noiseFloorMedian = stats.baselineMedian;
  stats.noiseFloorMad = stats.baselineMad;

  const normalPeaks: number[] = [];
  const intentionalPeaks: number[] = [];
  const intentionalDurations: number[] = [];
  const intentionalRiseTimes: number[] = [];
  const intentionalFallTimes: number[] = [];
  const doubleSpacings: number[] = [];

  for (const seg of segments) {
    const candidates = findCandidatesInSegment(seg, fsHz);
    if (seg.label === "REST") {
      for (const c of candidates) normalPeaks.push(peakUv(c));
    } else if (seg.label === "SINGLE_BLINK") {
      if (candidates.length > 0) {
        const c = candidates.reduce((best, cur) => (peakUv(cur) > peakUv(best) ? cur : best));
        intentionalPeaks.push(peakUv(c));
        intentionalDurations.push(c.durationS);
        let peakIdx = 0;
        let bestAbs = -Infinity;
        for (let i = 0; i < c.frontalWindow.length; i++) {
          const v = Math.abs(c.frontalWindow[i]);
          if (v > bestAbs) {
            bestAbs = v;
            peakIdx = i;
          }
        }
        intentionalRiseTimes.push(peakIdx / fsHz);
        intentionalFallTimes.push((c.frontalWindow.length - 1 - peakIdx) / fsHz);
      }
    } else if (seg.label === "DOUBLE_BLINK") {
      if (candidates.length >= 2) {
        const topTwo = [...candidates].sort((a, b) => peakUv(b) - peakUv(a)).slice(0, 2);
        const [a, b] = topTwo.sort((x, y) => x.startTimeS - y.startTimeS);
        const spacing = b.startTimeS - a.endTimeS;
        if (spacing > 0) doubleSpacings.push(spacing);
      }
    }
  }

  [stats.normalBlinkPeakMedian, stats.normalBlinkPeakMad] = medianMad(normalPeaks);
  stats.nRestCandidates = normalPeaks.length;

  [stats.intentionalBlinkPeakMedian, stats.intentionalBlinkPeakMad] = medianMad(intentionalPeaks);
  [stats.intentionalDurationMedianS, stats.intentionalDurationMadS] = medianMad(intentionalDurations);
  [stats.intentionalRiseTimeMedianS] = medianMad(intentionalRiseTimes);
  [stats.intentionalFallTimeMedianS] = medianMad(intentionalFallTimes);
  stats.nSingleCandidates = intentionalPeaks.length;

  [stats.doubleBlinkSpacingMedianS, stats.doubleBlinkSpacingMadS] = medianMad(doubleSpacings);
  stats.nDoublePairs = doubleSpacings.length;

  return stats;
}

export function deriveConfigOverrides(
  stats: CalibrationStats,
  prominenceMarginSigma = 1.5,
  intervalMarginS = 0.15,
  minRelativeProminenceSpread = 0.5,
  minDurationSpreadS = 0.02,
): DeepPartial<BciConfig> & { calibrationStats: CalibrationStats } {
  const prominenceSpread = Math.max(
    stats.intentionalBlinkPeakMad * MAD_TO_SIGMA,
    minRelativeProminenceSpread * stats.intentionalBlinkPeakMedian,
  );
  const minProminence = Math.max(
    stats.intentionalBlinkPeakMedian - prominenceMarginSigma * prominenceSpread,
    stats.noiseFloorMedian + 2 * MAD_TO_SIGMA * stats.noiseFloorMad,
    1e-6,
  );

  const durationSpread = Math.max(stats.intentionalDurationMadS, minDurationSpreadS);
  const minWidth = Math.max(stats.intentionalDurationMedianS - 3 * durationSpread, 0.02);
  const maxWidth = stats.intentionalDurationMedianS + 4 * durationSpread + 0.1;

  const overrides: DeepPartial<BciConfig> & { calibrationStats: CalibrationStats } = {
    candidateDetection: {
      minProminenceUv: round(minProminence, 4),
      minBlinkWidthS: round(minWidth, 4),
      maxBlinkWidthS: round(maxWidth, 4),
    },
    calibrationStats: stats,
  };

  if (stats.nDoublePairs > 0) {
    const spacing = stats.doubleBlinkSpacingMedianS;
    const spacingSpread = Math.max(stats.doubleBlinkSpacingMadS * MAD_TO_SIGMA, 0.05);
    const minInterval = Math.max(spacing - spacingSpread - intervalMarginS, 0.08);
    const maxInterval = spacing + spacingSpread + intervalMarginS;
    overrides.doubleBlink = { minIntervalS: round(minInterval, 4), maxIntervalS: round(maxInterval, 4) };
  }

  return overrides;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
