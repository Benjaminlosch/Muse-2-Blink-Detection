/**
 * Cheap, streaming-friendly feature extraction — port of
 * detection/features.py. Every feature is O(window_length) with small
 * constants (max/min/sum/diff), matching the Python original's design goal
 * of staying cheap enough for an eventual embedded port.
 */
import type { BlinkFeatures } from "../types";
import { checkAf7Af8Agreement } from "../dsp/spatial";

function trapz(y: Float64Array, dx: number): number {
  if (y.length < 2) return 0;
  let sum = (y[0] + y[y.length - 1]) / 2;
  for (let i = 1; i < y.length - 1; i++) sum += y[i];
  return sum * dx;
}

function argmaxAbs(values: Float64Array): number {
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

export function extractFeatures(
  frontalWindow: Float64Array,
  af7Window: Float64Array,
  af8Window: Float64Array,
  fsHz: number,
  baselineLevel: number,
  timeSincePreviousValidBlinkS: number,
  agreementMinCorrelation = 0.6,
  agreementMaxAmplitudeRatio = 3.0,
): BlinkFeatures {
  const n = frontalWindow.length;
  const dt = 1 / fsHz;
  const durationS = Math.max(n - 1, 0) * dt;

  const peakIdx = n > 0 ? argmaxAbs(frontalWindow) : 0;
  const peakAmplitude = n > 0 ? frontalWindow[peakIdx] : 0;
  const absPeakAmplitude = Math.abs(peakAmplitude);

  let positiveExcursion = 0;
  let negativeExcursion = 0;
  if (n > 0) {
    positiveExcursion = frontalWindow[0];
    negativeExcursion = frontalWindow[0];
    for (let i = 1; i < n; i++) {
      if (frontalWindow[i] > positiveExcursion) positiveExcursion = frontalWindow[i];
      if (frontalWindow[i] < negativeExcursion) negativeExcursion = frontalWindow[i];
    }
  }
  const peakToPeakAmplitude = positiveExcursion - negativeExcursion;

  const edgeLevel = n > 0 ? (frontalWindow[0] + frontalWindow[n - 1]) / 2 : 0;
  const peakProminence = Math.max(absPeakAmplitude - Math.abs(edgeLevel - baselineLevel), 0);

  let riseTimeS = 0;
  let fallTimeS = 0;
  let maxSlope = 0;
  let areaUnderCurve = 0;
  let rms = absPeakAmplitude;
  let signalEnergy = n === 1 ? frontalWindow[0] ** 2 : 0;

  if (n > 1) {
    riseTimeS = peakIdx * dt;
    fallTimeS = (n - 1 - peakIdx) * dt;
    let maxAbsSlope = 0;
    let sumSq = 0;
    for (let i = 0; i < n - 1; i++) {
      const slope = Math.abs((frontalWindow[i + 1] - frontalWindow[i]) / dt);
      if (slope > maxAbsSlope) maxAbsSlope = slope;
    }
    maxSlope = maxAbsSlope;
    const absWindow = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      absWindow[i] = Math.abs(frontalWindow[i]);
      sumSq += frontalWindow[i] * frontalWindow[i];
    }
    areaUnderCurve = trapz(absWindow, dt);
    rms = Math.sqrt(sumSq / n);
    signalEnergy = sumSq;
  }

  const agreement = checkAf7Af8Agreement(af7Window, af8Window, agreementMinCorrelation, agreementMaxAmplitudeRatio);
  const baselineDeviation = edgeLevel - baselineLevel;

  return {
    peakAmplitude,
    absPeakAmplitude,
    peakProminence,
    positiveExcursion,
    negativeExcursion,
    peakToPeakAmplitude,
    durationS,
    riseTimeS,
    fallTimeS,
    maxSlope,
    areaUnderCurve,
    rms,
    signalEnergy,
    af7Af8Correlation: agreement.correlation,
    af7Af8AmplitudeRatio: agreement.amplitudeRatio,
    baselineDeviation,
    timeSincePreviousValidBlinkS,
  };
}
