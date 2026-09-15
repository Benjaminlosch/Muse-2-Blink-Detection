import { describe, expect, it } from "vitest";
import { CausalBlinkBandFilter } from "../dsp/filters";
import { SignalSimulator } from "../simulation/signalGenerator";
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
