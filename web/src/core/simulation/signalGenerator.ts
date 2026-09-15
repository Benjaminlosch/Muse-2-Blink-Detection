/**
 * Synthetic Muse-2-like signal generator — port of
 * simulation/signal_generator.py, for the browser's "Simulation Mode"
 * (project brief section 21). A *plausibility* simulator for interactive
 * demo/dev purposes, not a validated physiological model — see the Python
 * original's module docstring.
 *
 * This does not need bit-for-bit RNG parity with Python (see utils/rng.ts);
 * the safety-relevant "one of everything" equivalence test
 * (core/pipeline.test.ts) replays raw samples exported directly from
 * Python instead of regenerating them here.
 */
import { SeededRng } from "../utils/rng";

export const CHANNELS = ["AF7", "AF8", "TP9", "TP10"] as const;
export type ChannelName = (typeof CHANNELS)[number];

export type SimEventLabel =
  | "single_blink" | "double_blink" | "slow_blink" | "oversized_transient" | "random_spike"
  | "head_motion" | "muscle_burst" | "jaw_clench" | "baseline_drift" | "sixty_hz"
  | "electrode_dropout" | "single_channel_artifact";

export interface SimEvent {
  label: SimEventLabel;
  onsetS: number;
  durationS: number;
  params?: Record<string, number | string>;
}

export interface SimulatedRecording {
  fsHz: number;
  timestamps: Float64Array;
  channels: Record<ChannelName, Float64Array>;
  accel: { x: Float64Array; y: Float64Array; z: Float64Array };
  groundTruth: Array<{ startS: number; endS: number; label: string }>;
}

function hanning(n: number): Float64Array {
  if (n <= 0) return new Float64Array(0);
  if (n === 1) return Float64Array.of(1);
  const w = new Float64Array(n);
  for (let k = 0; k < n; k++) w[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1));
  return w;
}

function doubleExpPulse(n: number, riseFrac = 0.35): Float64Array {
  const shape = new Float64Array(n);
  let maxAbs = 1e-12;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const rise = 1 - Math.exp(-t / Math.max(riseFrac, 1e-3));
    const fall = Math.exp(-t / Math.max(1 - riseFrac, 1e-3));
    const v = rise * fall;
    shape[i] = v;
    if (v > maxAbs) maxAbs = v;
  }
  for (let i = 0; i < n; i++) shape[i] /= maxAbs;
  return shape;
}

export class SignalSimulator {
  private readonly rng: SeededRng;
  private readonly fsHz: number;
  private readonly imuFsHz: number;

  constructor(fsHz = 256.0, imuFsHz = 52.0, seed = 42) {
    this.fsHz = fsHz;
    this.imuFsHz = imuFsHz;
    this.rng = new SeededRng(seed);
  }

  private baselineNoise(n: number, stdUv = 4.0): Float64Array {
    const white = new Float64Array(n);
    for (let i = 0; i < n; i++) white[i] = this.rng.normal(0, stdUv);
    const pink = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = white[Math.max(i - 1, 0)];
      const b = white[i];
      const c = white[Math.min(i + 1, n - 1)];
      pink[i] = 0.25 * a + 0.5 * b + 0.25 * c;
    }
    const phase = this.rng.uniform(0, 2 * Math.PI);
    for (let i = 0; i < n; i++) {
      const t = i / this.fsHz;
      pink[i] += 1.5 * Math.sin(2 * Math.PI * 10.0 * t + phase);
    }
    return pink;
  }

  render(totalDurationS: number, events: SimEvent[]): SimulatedRecording {
    const n = Math.floor(totalDurationS * this.fsHz);
    const timestamps = new Float64Array(n);
    for (let i = 0; i < n; i++) timestamps[i] = i / this.fsHz;

    const channels = Object.fromEntries(CHANNELS.map((ch) => [ch, this.baselineNoise(n)])) as Record<ChannelName, Float64Array>;

    const nImu = Math.floor(totalDurationS * this.imuFsHz);
    const accelSmall = { x: new Float64Array(nImu), y: new Float64Array(nImu), z: new Float64Array(nImu) };
    for (let i = 0; i < nImu; i++) {
      accelSmall.x[i] = this.rng.normal(0, 0.01);
      accelSmall.y[i] = this.rng.normal(0, 0.01);
      accelSmall.z[i] = 1.0 + this.rng.normal(0, 0.01);
    }

    const groundTruth: Array<{ startS: number; endS: number; label: string }> = [];
    const sorted = [...events].sort((a, b) => a.onsetS - b.onsetS);
    for (const ev of sorted) {
      this.applyEvent(channels, accelSmall, timestamps, ev, nImu);
      groundTruth.push({ startS: ev.onsetS, endS: ev.onsetS + ev.durationS, label: ev.label });
    }

    const accel = { x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n) };
    if (nImu > 1) {
      const imuT = imuTimestamps(nImu, this.imuFsHz);
      for (const axis of ["x", "y", "z"] as const) {
        linInterpInto(accel[axis], timestamps, imuT, accelSmall[axis]);
      }
    } else {
      const fallback = nImu > 0 ? accelSmall : null;
      accel.x.fill(fallback ? fallback.x[0] : 0);
      accel.y.fill(fallback ? fallback.y[0] : 0);
      accel.z.fill(fallback ? fallback.z[0] : 0);
    }

    return { fsHz: this.fsHz, timestamps, channels, accel, groundTruth };
  }

  private slice(timestamps: Float64Array, onsetS: number, durationS: number): [number, number] {
    let startIdx = Math.floor(onsetS * this.fsHz);
    const n = Math.max(Math.floor(durationS * this.fsHz), 1);
    let endIdx = Math.min(startIdx + n, timestamps.length);
    startIdx = Math.max(startIdx, 0);
    return [startIdx, endIdx];
  }

  private addBlinkPulse(
    channels: Record<string, Float64Array>,
    timestamps: Float64Array,
    onsetS: number,
    durationS: number,
    ampUv: number,
    corr = 0.95,
    riseFrac = 0.35,
  ): void {
    const [start, end] = this.slice(timestamps, onsetS, durationS);
    const n = end - start;
    if (n <= 0) return;
    const shape = doubleExpPulse(n, riseFrac);
    for (const ch of Object.keys(channels)) {
      if (ch === "AF7" || ch === "AF8") {
        const asym = this.rng.normal(1.0, (1 - corr) * 0.3);
        for (let i = 0; i < n; i++) channels[ch][start + i] += shape[i] * ampUv * asym;
      } else if (ch === "TP9" || ch === "TP10") {
        for (let i = 0; i < n; i++) channels[ch][start + i] += shape[i] * ampUv * 0.15;
      }
    }
  }

  private applyEvent(
    channels: Record<ChannelName, Float64Array>,
    accel: { x: Float64Array; y: Float64Array; z: Float64Array },
    timestamps: Float64Array,
    ev: SimEvent,
    nImu: number,
  ): void {
    const p = ev.params ?? {};
    const num = (key: string, fallback: number) => (typeof p[key] === "number" ? (p[key] as number) : fallback);
    const str = (key: string, fallback: string) => (typeof p[key] === "string" ? (p[key] as string) : fallback);

    switch (ev.label) {
      case "single_blink":
        this.addBlinkPulse(channels, timestamps, ev.onsetS, ev.durationS, num("amplitude_uv", 90), 0.97);
        break;
      case "double_blink": {
        const gapS = num("gap_s", 0.25);
        const singleDur = num("single_duration_s", 0.18);
        const amp = num("amplitude_uv", 90);
        this.addBlinkPulse(channels, timestamps, ev.onsetS, singleDur, amp, 0.97);
        this.addBlinkPulse(channels, timestamps, ev.onsetS + singleDur + gapS, singleDur, amp, 0.97);
        break;
      }
      case "slow_blink":
        this.addBlinkPulse(channels, timestamps, ev.onsetS, ev.durationS, num("amplitude_uv", 80), 0.95, 0.5);
        break;
      case "oversized_transient":
        this.addBlinkPulse(channels, timestamps, ev.onsetS, ev.durationS, num("amplitude_uv", 400), 0.9);
        break;
      case "random_spike": {
        const amp = num("amplitude_uv", 150);
        const target = typeof p.channel === "string" ? (p.channel as ChannelName) : null;
        const [start, end] = this.slice(timestamps, ev.onsetS, ev.durationS);
        const targets = target ? [target] : CHANNELS;
        for (const ch of targets) {
          if (end > start) channels[ch][start] += amp * this.rng.choice([-1, 1]);
        }
        break;
      }
      case "head_motion": {
        const amp = num("amplitude_uv", 60);
        const accelG = num("accel_g", 0.3);
        const [start, end] = this.slice(timestamps, ev.onsetS, ev.durationS);
        const n = end - start;
        if (n <= 0) break;
        const win = hanning(n);
        for (const ch of CHANNELS) {
          const jitter = this.rng.normal(0, 0.1);
          for (let i = 0; i < n; i++) {
            const wobble = amp * Math.sin((Math.PI * i) / Math.max(n - 1, 1)) * win[i];
            channels[ch][start + i] += wobble + jitter * wobble;
          }
        }
        const imuStart = Math.max(Math.floor(ev.onsetS * this.imuFsHz), 0);
        const imuN = Math.max(Math.floor(ev.durationS * this.imuFsHz), 1);
        const imuEnd = Math.min(imuStart + imuN, nImu);
        if (imuEnd > imuStart) {
          const burstWin = hanning(imuEnd - imuStart);
          for (let i = 0; i < imuEnd - imuStart; i++) {
            accel.x[imuStart + i] += accelG * burstWin[i];
            accel.y[imuStart + i] += accelG * burstWin[i] * 0.5;
          }
        }
        break;
      }
      case "muscle_burst": {
        const amp = num("amplitude_uv", 70);
        const [start, end] = this.slice(timestamps, ev.onsetS, ev.durationS);
        const n = end - start;
        if (n <= 0) break;
        const win = hanning(n);
        for (const ch of CHANNELS) {
          const scale = this.rng.uniform(0.6, 1.0);
          for (let i = 0; i < n; i++) channels[ch][start + i] += this.rng.normal(0, amp) * win[i] * scale;
        }
        break;
      }
      case "jaw_clench": {
        const amp = num("amplitude_uv", 130);
        const [start, end] = this.slice(timestamps, ev.onsetS, ev.durationS);
        const n = end - start;
        if (n <= 0) break;
        const win = hanning(n);
        for (const ch of CHANNELS) {
          for (let i = 0; i < n; i++) channels[ch][start + i] += this.rng.normal(0, amp) * win[i];
        }
        break;
      }
      case "baseline_drift": {
        const amp = num("amplitude_uv", 50);
        const [start, end] = this.slice(timestamps, ev.onsetS, ev.durationS);
        const n = end - start;
        if (n <= 0) break;
        for (const ch of CHANNELS) {
          for (let i = 0; i < n; i++) {
            const t = n > 1 ? i / (n - 1) : 0;
            channels[ch][start + i] += amp * (0.5 - 0.5 * Math.cos(Math.PI * t));
          }
        }
        break;
      }
      case "sixty_hz": {
        const amp = num("amplitude_uv", 15);
        const [start, end] = this.slice(timestamps, ev.onsetS, ev.durationS);
        const n = end - start;
        if (n <= 0) break;
        for (const ch of CHANNELS) {
          const scale = this.rng.uniform(0.8, 1.2);
          for (let i = 0; i < n; i++) {
            const t = timestamps[start + i];
            channels[ch][start + i] += amp * Math.sin(2 * Math.PI * 60.0 * t) * scale;
          }
        }
        break;
      }
      case "electrode_dropout": {
        const target = str("channel", "AF7") as ChannelName;
        const flat = num("flat_value_uv", 0.0);
        const [start, end] = this.slice(timestamps, ev.onsetS, ev.durationS);
        if (end > start) channels[target].fill(flat, start, end);
        break;
      }
      case "single_channel_artifact": {
        const target = str("channel", "AF7") as ChannelName;
        const amp = num("amplitude_uv", 120);
        this.addBlinkPulse({ [target]: channels[target] }, timestamps, ev.onsetS, ev.durationS, amp, 1.0);
        break;
      }
    }
  }
}

function imuTimestamps(nImu: number, imuFsHz: number): Float64Array {
  const t = new Float64Array(nImu);
  for (let i = 0; i < nImu; i++) t[i] = i / imuFsHz;
  return t;
}

/** Linear interpolation into a pre-allocated output array, matching
 * numpy.interp's clamped-edges behavior. */
function linInterpInto(out: Float64Array, targetT: Float64Array, sourceT: Float64Array, sourceV: Float64Array): void {
  if (sourceT.length === 0) return;
  let j = 0;
  for (let i = 0; i < targetT.length; i++) {
    const t = targetT[i];
    if (t <= sourceT[0]) {
      out[i] = sourceV[0];
      continue;
    }
    if (t >= sourceT[sourceT.length - 1]) {
      out[i] = sourceV[sourceT.length - 1];
      continue;
    }
    while (j < sourceT.length - 2 && sourceT[j + 1] < t) j++;
    const t0 = sourceT[j];
    const t1 = sourceT[j + 1];
    const frac = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    out[i] = sourceV[j] + frac * (sourceV[j + 1] - sourceV[j]);
  }
}

/** One of every event type, spaced out — mirrors
 * simulation/signal_generator.py's build_demo_scenario() exactly (same
 * onsets/durations/params), used by the "one of everything" equivalence
 * test and by the UI's built-in demo scenario. */
export function buildDemoScenario(): SimEvent[] {
  return [
    { label: "single_blink", onsetS: 2.0, durationS: 0.2, params: { amplitude_uv: 90 } },
    { label: "double_blink", onsetS: 5.0, durationS: 0.58, params: { amplitude_uv: 95, gap_s: 0.22 } },
    { label: "slow_blink", onsetS: 9.0, durationS: 0.45, params: { amplitude_uv: 80 } },
    { label: "oversized_transient", onsetS: 12.0, durationS: 0.3, params: { amplitude_uv: 450 } },
    { label: "random_spike", onsetS: 15.0, durationS: 0.02, params: { amplitude_uv: 150 } },
    { label: "head_motion", onsetS: 17.0, durationS: 0.8, params: { amplitude_uv: 60, accel_g: 0.35 } },
    { label: "muscle_burst", onsetS: 20.0, durationS: 0.4, params: { amplitude_uv: 70 } },
    { label: "jaw_clench", onsetS: 23.0, durationS: 0.6, params: { amplitude_uv: 130 } },
    { label: "baseline_drift", onsetS: 26.0, durationS: 3.0, params: { amplitude_uv: 50 } },
    { label: "sixty_hz", onsetS: 30.0, durationS: 2.0, params: { amplitude_uv: 15 } },
    { label: "electrode_dropout", onsetS: 33.0, durationS: 1.5, params: { channel: "AF7" } },
    { label: "single_channel_artifact", onsetS: 36.0, durationS: 0.2, params: { channel: "AF8", amplitude_uv: 120 } },
    { label: "double_blink", onsetS: 39.0, durationS: 0.54, params: { amplitude_uv: 95, gap_s: 0.18 } },
  ];
}
