import { describe, expect, it } from "vitest";
import { defaultConfig, mergeConfig } from "./config";
import { BlinkPipeline, channelValue } from "./pipeline";
import { SignalSimulator } from "./simulation/signalGenerator";
import type { Sample } from "./types";

/**
 * TS mirror of tests/test_pipeline_channel_selection.py — regression test
 * for acquisition.primaryChannels (pipeline.ts's channelValue indirection),
 * added after discovering on real Muse 2 hardware that TP9/TP10 (ear-clip
 * electrodes) can show a much cleaner blink signal than AF7/AF8 (forehead
 * electrodes) depending on skin contact. See docs/CALIBRATION.md "Channel
 * selection".
 */
function doubleBlinkSamples(): Sample[] {
  const sim = new SignalSimulator(256.0, 52.0, 7);
  const rec = sim.render(6.0, [
    { label: "double_blink", onsetS: 2.0, durationS: 0.58, params: { amplitude_uv: 95, gap_s: 0.22 } },
  ]);
  const samples: Sample[] = [];
  for (let i = 0; i < rec.timestamps.length; i++) {
    samples.push({
      timestampS: rec.timestamps[i],
      af7: rec.channels.AF7[i],
      af8: rec.channels.AF8[i],
      tp9: rec.channels.TP9[i],
      tp10: rec.channels.TP10[i],
      accelX: 0,
      accelY: 0,
      accelZ: 1,
    });
  }
  return samples;
}

describe("BlinkPipeline acquisition.primaryChannels", () => {
  it("defaults to AF7/AF8", () => {
    expect(defaultConfig().acquisition.primaryChannels).toEqual(["AF7", "AF8"]);
  });

  it("actually redirects which raw fields feed detection", () => {
    // The simulator writes the full blink pulse to AF7/AF8 and only a weak
    // (0.15x) volume-conducted remnant to TP9/TP10 — same physiology as
    // simulation/signal_generator.py. So the same samples must confirm a
    // double blink on AF7/AF8 and must NOT on TP9/TP10 (remnant amplitude
    // falls under minProminenceUv) — proving this config value is actually
    // read, not dead configuration.
    const samples = doubleBlinkSamples();
    const config = defaultConfig();

    const af7Af8Pipeline = new BlinkPipeline(config, 256.0);
    const af7Af8Doubles = samples
      .map((s) => af7Af8Pipeline.processSample(s))
      .filter((r) => r.stateEvent?.eventType === "DOUBLE_BLINK_CONFIRMED");
    expect(af7Af8Doubles.length).toBe(1);

    const tp9Tp10Config = mergeConfig(config, { acquisition: { primaryChannels: ["TP9", "TP10"] } });
    const tp9Tp10Pipeline = new BlinkPipeline(tp9Tp10Config, 256.0);
    const tp9Tp10Doubles = samples
      .map((s) => tp9Tp10Pipeline.processSample(s))
      .filter((r) => r.stateEvent?.eventType === "DOUBLE_BLINK_CONFIRMED");
    expect(tp9Tp10Doubles.length).toBe(0);
  });

  it("rejects a primaryChannels list of the wrong length", () => {
    const config = mergeConfig(defaultConfig(), { acquisition: { primaryChannels: ["AF7"] } });
    expect(() => new BlinkPipeline(config, 256.0)).toThrow();
  });

  it("rejects an unknown channel name", () => {
    const config = mergeConfig(defaultConfig(), { acquisition: { primaryChannels: ["AF7", "FPZ"] } });
    expect(() => new BlinkPipeline(config, 256.0)).toThrow();
  });

  it("channelValue reads the right Sample field case-insensitively", () => {
    const sample: Sample = { timestampS: 0, af7: 1, af8: 2, tp9: 3, tp10: 4 };
    expect(channelValue(sample, "AF7")).toBe(1);
    expect(channelValue(sample, "tp10")).toBe(4);
    expect(() => channelValue(sample, "FPZ")).toThrow();
  });
});
