import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig, mergeConfig } from "./config";
import { BlinkPipeline } from "./pipeline";
import { buildDemoScenario, SignalSimulator } from "./simulation/signalGenerator";
import type { Sample } from "./types";

interface GoldenRunFixture {
  fsHz: number;
  groundTruth: Array<{ startS: number; endS: number; label: string }>;
  samples: {
    timestampS: number[];
    af7: number[];
    af8: number[];
    tp9: number[];
    tp10: number[];
    accelX: number[];
    accelY: number[];
    accelZ: number[];
  };
  expected: {
    filteredFrontal: number[];
    candidates: Array<{
      startTimeS: number;
      endTimeS: number;
      durationS: number;
      widthValid: boolean;
      likelyFilterRebound: boolean;
      peakSign: number;
      classification?: { isValidBlink: boolean; confidence: number; rejectionReasons: string[] };
    }>;
    stateEvents: Array<{
      eventType: string;
      timestampS: number;
      firstBlinkTimestampS: number;
      secondBlinkTimestampS: number | null;
      interBlinkIntervalS: number | null;
      confidence: number;
    }>;
    gateDecisions: Array<{ command: string; confidenceLevel: string; reason: string }>;
  };
}

function loadFixture(): GoldenRunFixture {
  const path = join(__dirname, "__fixtures__", "pipelineGoldenRun.json");
  return JSON.parse(readFileSync(path, "utf-8")) as GoldenRunFixture;
}

/**
 * Python (BlinkPipeline run against build_demo_scenario(), seed=42) is the
 * golden reference for this test (project brief sections 7/32/33). We do
 * NOT regenerate the input in TypeScript — we replay the exact raw samples
 * Python generated and assert the TS pipeline reproduces the same discrete
 * decisions (candidate validity, event types, commands — exact match) and
 * continuous values (confidence, timestamps, filtered signal — within a
 * documented tolerance). A safety-relevant divergence here is a test
 * failure, not something to paper over by loosening the assertion.
 */
describe("BlinkPipeline vs Python golden run (demo scenario)", () => {
  const fixture = loadFixture();
  const config = defaultConfig();
  const pipeline = new BlinkPipeline(config, fixture.fsHz);

  const n = fixture.samples.timestampS.length;
  const actualFilteredFrontal: number[] = [];
  const actualCandidates: GoldenRunFixture["expected"]["candidates"] = [];
  const actualStateEvents: GoldenRunFixture["expected"]["stateEvents"] = [];
  const actualGateDecisions: GoldenRunFixture["expected"]["gateDecisions"] = [];

  for (let i = 0; i < n; i++) {
    const sample: Sample = {
      timestampS: fixture.samples.timestampS[i],
      af7: fixture.samples.af7[i],
      af8: fixture.samples.af8[i],
      tp9: fixture.samples.tp9[i],
      tp10: fixture.samples.tp10[i],
      accelX: fixture.samples.accelX[i],
      accelY: fixture.samples.accelY[i],
      accelZ: fixture.samples.accelZ[i],
    };
    const result = pipeline.processSample(sample);
    actualFilteredFrontal.push(result.frontalSignal);

    if (result.candidate !== null) {
      actualCandidates.push({
        startTimeS: result.candidate.startTimeS,
        endTimeS: result.candidate.endTimeS,
        durationS: result.candidate.durationS,
        widthValid: result.candidate.widthValid,
        likelyFilterRebound: result.candidate.likelyFilterRebound,
        peakSign: result.candidate.peakSign,
        classification: result.classification
          ? {
              isValidBlink: result.classification.isValidBlink,
              confidence: result.classification.confidence,
              rejectionReasons: result.classification.rejectionReasons,
            }
          : undefined,
      });
    }

    if (result.stateEvent !== null) {
      actualStateEvents.push({
        eventType: result.stateEvent.eventType,
        timestampS: result.stateEvent.timestampS,
        firstBlinkTimestampS: result.stateEvent.firstBlinkTimestampS,
        secondBlinkTimestampS: result.stateEvent.secondBlinkTimestampS,
        interBlinkIntervalS: result.stateEvent.interBlinkIntervalS,
        confidence: result.stateEvent.confidence,
      });
      actualGateDecisions.push({
        command: result.gateDecision.command,
        confidenceLevel: result.gateDecision.confidenceLevel,
        reason: result.gateDecision.reason,
      });
    }
  }

  it("detects the exact same number of candidates as Python", () => {
    expect(actualCandidates.length).toBe(fixture.expected.candidates.length);
  });

  it("agrees on width_valid / likely_filter_rebound / peak_sign for every candidate", () => {
    for (let i = 0; i < fixture.expected.candidates.length; i++) {
      const exp = fixture.expected.candidates[i];
      const act = actualCandidates[i];
      expect(act.widthValid, `candidate ${i} widthValid`).toBe(exp.widthValid);
      expect(act.likelyFilterRebound, `candidate ${i} likelyFilterRebound`).toBe(exp.likelyFilterRebound);
      expect(act.peakSign, `candidate ${i} peakSign`).toBe(exp.peakSign);
      expect(act.startTimeS, `candidate ${i} startTimeS`).toBeCloseTo(exp.startTimeS, 3);
      expect(act.durationS, `candidate ${i} durationS`).toBeCloseTo(exp.durationS, 3);
    }
  });

  it("agrees on classification.is_valid_blink and rejection reasons for every candidate", () => {
    for (let i = 0; i < fixture.expected.candidates.length; i++) {
      const exp = fixture.expected.candidates[i].classification;
      const act = actualCandidates[i].classification;
      if (exp === undefined) {
        expect(act).toBeUndefined();
        continue;
      }
      expect(act, `candidate ${i} classification`).toBeDefined();
      expect(act!.isValidBlink, `candidate ${i} isValidBlink`).toBe(exp.isValidBlink);
      expect(act!.rejectionReasons, `candidate ${i} rejectionReasons`).toEqual(exp.rejectionReasons);
      // Confidence involves a few chained floating-point ops (geometric
      // mean, z-scores); 1e-4 absolute tolerance is generous relative to
      // its [0,1] range while still catching a real divergence.
      expect(act!.confidence, `candidate ${i} confidence`).toBeCloseTo(exp.confidence, 4);
    }
  });

  it("produces the exact same sequence of state-machine event types", () => {
    expect(actualStateEvents.map((e) => e.eventType)).toEqual(fixture.expected.stateEvents.map((e) => e.eventType));
  });

  it("agrees on state-event timestamps and confidence within tolerance", () => {
    for (let i = 0; i < fixture.expected.stateEvents.length; i++) {
      const exp = fixture.expected.stateEvents[i];
      const act = actualStateEvents[i];
      expect(act.timestampS, `event ${i} timestampS`).toBeCloseTo(exp.timestampS, 3);
      expect(act.confidence, `event ${i} confidence`).toBeCloseTo(exp.confidence, 4);
      if (exp.interBlinkIntervalS !== null) {
        expect(act.interBlinkIntervalS, `event ${i} interBlinkIntervalS`).toBeCloseTo(exp.interBlinkIntervalS, 3);
      }
    }
  });

  it("produces the exact same commands as Python — the core safety property", () => {
    expect(actualGateDecisions.map((g) => g.command)).toEqual(fixture.expected.gateDecisions.map((g) => g.command));
    expect(actualGateDecisions.map((g) => g.reason)).toEqual(fixture.expected.gateDecisions.map((g) => g.reason));
  });

  it("produces exactly two DOUBLE_BLINK_CONFIRMED events and no other non-HOLD commands", () => {
    const doubleBlinks = actualStateEvents.filter((e) => e.eventType === "DOUBLE_BLINK_CONFIRMED");
    expect(doubleBlinks.length).toBe(2);
    const nonHold = actualGateDecisions.filter((g) => g.command !== "HOLD");
    expect(nonHold.map((g) => g.command)).toEqual(["OPEN", "CLOSE"]);
  });

  it("filtered frontal signal matches Python within tolerance", () => {
    let maxAbsDiff = 0;
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(actualFilteredFrontal[i] - fixture.expected.filteredFrontal[i]);
      if (diff > maxAbsDiff) maxAbsDiff = diff;
    }
    // The filtered signal ranges into the hundreds of uV for artifact
    // events (e.g. the 450uV oversized transient); 1e-4 is a tight
    // relative tolerance, not a loosened one.
    expect(maxAbsDiff).toBeLessThan(1e-4);
  });
});

/**
 * TS mirror of tests/test_end_to_end_simulation.py's
 * test_demo_scenario_holds_even_with_loosest_plausible_calibration_derived_agreement_gate
 * — guards the "keep it rejecting coughs/bumps" requirement: the agreement-
 * gate loosening in core/detection/calibration.ts's deriveConfigOverrides
 * is capped at af7Af8MinCorrelation=0.2 / af7Af8MaxAmplitudeRatio=6.0 in
 * the worst case. Confirm that even at those loosest bounds, the full demo
 * artifact scenario still resolves to HOLD for everything except the two
 * genuine double blinks.
 */
describe("BlinkPipeline demo scenario with loosest plausible calibration-derived agreement gate", () => {
  it("still holds for every artifact and only confirms the two genuine double blinks", () => {
    const config = mergeConfig(defaultConfig(), {
      spatial: { af7Af8MinCorrelation: 0.2, af7Af8MaxAmplitudeRatio: 6.0 },
    });

    const events = buildDemoScenario();
    const totalDurationS = Math.max(...events.map((e) => e.onsetS + e.durationS)) + 5.0;
    const sim = new SignalSimulator(256.0, 52.0, 42);
    const rec = sim.render(totalDurationS, events);

    const samples: Sample[] = [];
    for (let i = 0; i < rec.timestamps.length; i++) {
      samples.push({
        timestampS: rec.timestamps[i],
        af7: rec.channels.AF7[i],
        af8: rec.channels.AF8[i],
        tp9: rec.channels.TP9[i],
        tp10: rec.channels.TP10[i],
        accelX: rec.accel.x[i],
        accelY: rec.accel.y[i],
        accelZ: rec.accel.z[i],
      });
    }

    const pipeline = new BlinkPipeline(config, 256.0);
    const results = samples.map((s) => pipeline.processSample(s));

    const doubleBlinks = results.filter((r) => r.stateEvent?.eventType === "DOUBLE_BLINK_CONFIRMED");
    expect(doubleBlinks.length).toBe(2);
    const nonHold = results.filter((r) => r.gateDecision.command !== "HOLD");
    expect(nonHold.map((r) => r.gateDecision.command)).toEqual(["OPEN", "CLOSE"]);
  });
});
