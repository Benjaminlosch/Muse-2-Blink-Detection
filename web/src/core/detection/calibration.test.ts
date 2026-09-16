import { describe, expect, it } from "vitest";
import { CausalBlinkBandFilter } from "../dsp/filters";
import { BlinkPipeline } from "../pipeline";
import { defaultConfig, mergeConfig } from "../config";
import { SignalSimulator } from "../simulation/signalGenerator";
import { SeededRng } from "../utils/rng";
import type { Sample } from "../types";
import { computeCalibrationStats, deriveConfigOverrides, type TrialSegment } from "./calibration";

const FS = 256.0;

function filteredSegment(
  sim: SignalSimulator,
  label: TrialSegment["label"],
  events: Parameters<SignalSimulator["render"]>[1],
  durationS: number,
): TrialSegment {
  const rec = sim.render(durationS, events);
  const af7 = new CausalBlinkBandFilter(FS, 4.0, true).processBlock(rec.channels.AF7);
  const af8 = new CausalBlinkBandFilter(FS, 4.0, true).processBlock(rec.channels.AF8);
  const frontal = new Float64Array(af7.length);
  for (let i = 0; i < af7.length; i++) frontal[i] = (af7[i] + af8[i]) / 2;
  return { label, frontal, af7, af8 };
}

function buildSegments(seed: number): TrialSegment[] {
  const sim = new SignalSimulator(FS, 52.0, seed);
  const segments: TrialSegment[] = [];
  for (let i = 0; i < 3; i++) segments.push(filteredSegment(sim, "REST", [], 3.0));
  for (let i = 0; i < 3; i++) {
    segments.push(
      filteredSegment(sim, "SINGLE_BLINK", [{ label: "single_blink", onsetS: 1.0, durationS: 0.18, params: { amplitude_uv: 90 } }], 2.5),
    );
  }
  for (let i = 0; i < 3; i++) {
    segments.push(
      filteredSegment(
        sim, "DOUBLE_BLINK",
        [{ label: "double_blink", onsetS: 1.0, durationS: 0.58, params: { amplitude_uv: 90, gap_s: 0.22 } }],
        3.0,
      ),
    );
  }
  return segments;
}

function buildTightDoubleBlinkSegments(seed: number, gapS = 0.10): TrialSegment[] {
  const sim = new SignalSimulator(FS, 52.0, seed);
  const segments: TrialSegment[] = [];
  for (let i = 0; i < 3; i++) segments.push(filteredSegment(sim, "REST", [], 3.0));
  for (let i = 0; i < 3; i++) {
    segments.push(
      filteredSegment(sim, "SINGLE_BLINK", [{ label: "single_blink", onsetS: 1.0, durationS: 0.18, params: { amplitude_uv: 90 } }], 2.5),
    );
  }
  for (let i = 0; i < 3; i++) {
    segments.push(
      filteredSegment(
        sim, "DOUBLE_BLINK",
        [{ label: "double_blink", onsetS: 1.0, durationS: 0.5, params: { amplitude_uv: 90, gap_s: gapS } }],
        3.0,
      ),
    );
  }
  return segments;
}

describe("computeCalibrationStats", () => {
  it("counts exactly one blink per SINGLE_BLINK trial (ringing excluded)", () => {
    const stats = computeCalibrationStats(buildSegments(7), FS);
    expect(stats.nSingleTrials).toBe(3);
    expect(stats.nSingleCandidates).toBe(3);
    expect(stats.intentionalBlinkPeakMedian).toBeGreaterThan(50);
  });

  it("counts exactly one pair per DOUBLE_BLINK trial", () => {
    const stats = computeCalibrationStats(buildSegments(7), FS);
    expect(stats.nDoubleTrials).toBe(3);
    expect(stats.nDoublePairs).toBe(3);
    expect(stats.doubleBlinkSpacingMedianS).toBeGreaterThan(0);
  });

  it("derives sane, non-degenerate config overrides", () => {
    const stats = computeCalibrationStats(buildSegments(7), FS);
    const overrides = deriveConfigOverrides(stats);
    expect(overrides.candidateDetection!.minProminenceUv!).toBeGreaterThan(0);
    expect(overrides.candidateDetection!.minBlinkWidthS!).toBeLessThan(overrides.candidateDetection!.maxBlinkWidthS!);
    expect(overrides.doubleBlink?.minIntervalS).toBeGreaterThanOrEqual(0.08);
  });

  it("omits doubleBlink overrides when there is no double-blink data", () => {
    const stats = computeCalibrationStats([], FS);
    const overrides = deriveConfigOverrides(stats);
    expect(overrides.doubleBlink).toBeUndefined();
  });
});

/**
 * TS mirror of tests/test_calibration.py's second-pulse regression tests —
 * real-hardware bug, 2026-09-15: a calibration run that passed 3/3 single +
 * 3/3 double blinks still rejected 15/16 live candidates afterwards
 * (insufficient_prominence), including 5 deliberate double blinks. Root
 * cause: minProminenceUv/minBlinkWidthS were derived only from single-blink
 * stats, with no ceiling tying them to what double-blink second pulses
 * (which ride the first pulse's still-decaying filter tail — legitimately
 * weaker and shorter) actually measured.
 */
describe("deriveConfigOverrides double-blink second-pulse ceiling", () => {
  it("measures the second pulse's prominence lower than an isolated blink's", () => {
    const stats = computeCalibrationStats(buildTightDoubleBlinkSegments(7), FS);
    expect(stats.doubleBlinkSecondPulseProminenceMedian).toBeGreaterThan(0);
    expect(stats.doubleBlinkSecondPulseProminenceMedian).toBeLessThan(stats.intentionalBlinkPeakMedian);
  });

  it("never derives minProminenceUv above the measured second-pulse prominence", () => {
    const stats = computeCalibrationStats(buildTightDoubleBlinkSegments(7), FS);
    const overrides = deriveConfigOverrides(stats);
    const newMinProminence = overrides.candidateDetection!.minProminenceUv!;
    expect(newMinProminence).toBeLessThanOrEqual(stats.doubleBlinkSecondPulseProminenceMedian);

    // Prove this actually depends on the fix, not a coincidence: without
    // the measured second-pulse data, the old single-blink-only formula
    // must derive something looser (higher).
    const statsWithoutSecondPulseData = { ...stats, doubleBlinkSecondPulseProminenceMedian: 0 };
    const oldMinProminence = deriveConfigOverrides(statsWithoutSecondPulseData).candidateDetection!.minProminenceUv!;
    expect(newMinProminence).toBeLessThan(oldMinProminence);
  });

  it("end-to-end: a fresh tight double blink of similar amplitude is confirmed after calibration", () => {
    const calibSegments = buildTightDoubleBlinkSegments(7);
    const stats = computeCalibrationStats(calibSegments, FS);
    const overrides = deriveConfigOverrides(stats);
    const config = mergeConfig(defaultConfig(), overrides);

    const freshSim = new SignalSimulator(FS, 52.0, 99); // different seed from calibration
    const rec = freshSim.render(6.0, [
      { label: "double_blink", onsetS: 2.0, durationS: 0.5, params: { amplitude_uv: 90, gap_s: 0.10 } },
    ]);
    const samples: Sample[] = [];
    for (let i = 0; i < rec.timestamps.length; i++) {
      samples.push({
        timestampS: rec.timestamps[i],
        af7: rec.channels.AF7[i],
        af8: rec.channels.AF8[i],
        tp9: 0,
        tp10: 0,
      });
    }

    const pipeline = new BlinkPipeline(config, FS);
    const doubles = samples
      .map((s) => pipeline.processSample(s))
      .filter((r) => r.stateEvent?.eventType === "DOUBLE_BLINK_CONFIRMED");
    expect(doubles.length).toBe(1);
  });

  it("widens waitForSecondTimeoutS beyond maxIntervalS", () => {
    const stats = computeCalibrationStats(buildTightDoubleBlinkSegments(7), FS);
    const overrides = deriveConfigOverrides(stats);
    const db = overrides.doubleBlink!;
    expect(db.waitForSecondTimeoutS!).toBeGreaterThan(db.maxIntervalS!);
    expect(db.waitForSecondTimeoutS!).toBeGreaterThanOrEqual(0.7);
  });
});

function buildAsymmetricNoiseDoubleBlinkSegments(seed = 7, asymNoiseUv = 15.0): TrialSegment[] {
  const rng = new SeededRng(seed + 1000);
  const sim = new SignalSimulator(FS, 52.0, seed);
  const segments: TrialSegment[] = [];
  for (let i = 0; i < 3; i++) segments.push(filteredSegment(sim, "REST", [], 3.0));
  for (let i = 0; i < 3; i++) {
    segments.push(
      filteredSegment(sim, "SINGLE_BLINK", [{ label: "single_blink", onsetS: 1.0, durationS: 0.18, params: { amplitude_uv: 90 } }], 2.5),
    );
  }
  for (let i = 0; i < 3; i++) {
    const rec = sim.render(3.0, [{ label: "double_blink", onsetS: 1.0, durationS: 0.5, params: { amplitude_uv: 90, gap_s: 0.10 } }]);
    const af7 = new CausalBlinkBandFilter(FS, 4.0, true).processBlock(rec.channels.AF7);
    const af8 = new CausalBlinkBandFilter(FS, 4.0, true).processBlock(rec.channels.AF8);
    for (let i2 = 0; i2 < af7.length; i2++) af7[i2] += rng.normal(0, asymNoiseUv);
    for (let i2 = 0; i2 < af8.length; i2++) af8[i2] += rng.normal(0, asymNoiseUv * 1.5);
    const frontal = new Float64Array(af7.length);
    for (let i2 = 0; i2 < af7.length; i2++) frontal[i2] = (af7[i2] + af8[i2]) / 2;
    segments.push({ label: "DOUBLE_BLINK", frontal, af7, af8 });
  }
  return segments;
}

describe("deriveConfigOverrides AF7/AF8 agreement-gate loosening", () => {
  it("loosens the agreement gate for a noisier second pulse", () => {
    const stats = computeCalibrationStats(buildAsymmetricNoiseDoubleBlinkSegments(), FS);
    expect(stats.nDoublePairs).toBeGreaterThan(0);
    expect(stats.doubleBlinkSecondPulseCorrelationMedian).toBeLessThan(0.6);

    const overrides = deriveConfigOverrides(stats);
    const spatial = overrides.spatial!;
    expect(spatial.af7Af8MinCorrelation!).toBeGreaterThanOrEqual(0.2);
    expect(spatial.af7Af8MinCorrelation!).toBeLessThan(0.6);
    expect(spatial.af7Af8MaxAmplitudeRatio!).toBeGreaterThanOrEqual(3.0);
    expect(spatial.af7Af8MaxAmplitudeRatio!).toBeLessThanOrEqual(6.0);
  });

  it("never loosens the agreement gate for a clean second pulse", () => {
    const stats = computeCalibrationStats(buildTightDoubleBlinkSegments(7), FS);
    const overrides = deriveConfigOverrides(stats);
    expect(overrides.spatial!.af7Af8MinCorrelation).toBe(0.6);
    expect(overrides.spatial!.af7Af8MaxAmplitudeRatio).toBe(3.0);
  });
});
