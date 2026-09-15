/**
 * Central application state (zustand). Holds connection status, config,
 * calibration, a bounded ring buffer of recent pipeline results (for
 * charts + dashboard), and recording state. Updated by engine/appEngine.ts
 * (a module-level singleton, not a React component) — components only
 * ever read from here and call engine methods, never mutate pipeline
 * state directly, so "the UI displays the result of the safety gate, it
 * does not decide whether the hand should move" (project brief section 25)
 * holds structurally, not just by convention.
 */
import { create } from "zustand";
import type { BciConfig } from "../core/config";
import { defaultConfig } from "../core/config";
import type { CalibrationStats, Command, PipelineStepResult, Sample } from "../core/types";
import { defaultCalibrationStats } from "../core/types";
import type { RecordRow } from "./recording";

export type AcquisitionMode = "simulate" | "live" | "replay";
export type MuseConnState = "disconnected" | "connecting" | "connected";
export type Esp32ConnState = "disconnected" | "connecting" | "connected";

export type PageId =
  | "dashboard" | "liveEeg" | "filters" | "blinkDetector" | "doubleBlink" | "artifactRejection"
  | "calibration" | "commands" | "esp32" | "recorder" | "diagnostics" | "settings" | "about";

export interface LatencyStatsUi {
  n: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface AppState {
  page: PageId;
  setPage: (page: PageId) => void;

  mode: AcquisitionMode;
  fsHz: number;

  museConnState: MuseConnState;
  museDeviceName: string | null;
  museBatteryPercent: number | null;
  museError: string | null;

  esp32ConnState: Esp32ConnState;
  esp32CommHealthy: boolean;
  esp32OutputArmed: boolean;
  esp32LastCommandSent: Command | null;
  esp32LastCommandTimeMs: number | null;
  esp32Error: string | null;

  config: BciConfig;
  calibrationStats: CalibrationStats;

  /** Bounded ring buffers of recent results and their matching raw
   * samples, newest last, same indices. Charts/pages slice the tail they
   * need (e.g. last N seconds). */
  recentResults: PipelineStepResult[];
  recentRawSamples: Sample[];
  maxRecentResults: number;

  latestCommand: Command;
  latestConfidence: number | null;
  latencySummary: Record<string, LatencyStatsUi>;

  isRecording: boolean;
  recordedRows: RecordRow[];

  diagnosticsLog: string[];

  // --- actions (called by engine/appEngine.ts and UI) ---
  setMode: (mode: AcquisitionMode) => void;
  setMuseConnState: (s: MuseConnState, deviceName?: string | null) => void;
  setMuseBattery: (percent: number) => void;
  setMuseError: (message: string | null) => void;
  setEsp32ConnState: (s: Esp32ConnState) => void;
  setEsp32CommHealthy: (healthy: boolean) => void;
  setEsp32OutputArmed: (armed: boolean) => void;
  setEsp32LastCommand: (command: Command, atMs: number) => void;
  setEsp32Error: (message: string | null) => void;
  setConfig: (config: BciConfig) => void;
  setCalibrationStats: (stats: CalibrationStats) => void;
  pushResults: (results: PipelineStepResult[], rawSamples: Sample[]) => void;
  setLatencySummary: (summary: Record<string, LatencyStatsUi>) => void;
  startRecording: () => void;
  stopRecording: () => void;
  appendRecordedRows: (rows: RecordRow[]) => void;
  clearRecording: () => void;
  logDiagnostic: (line: string) => void;
  reset: () => void;
}

const MAX_RECENT_RESULTS = 20 * 256; // ~20s at 256Hz, generous upper display window

export const useAppStore = create<AppState>((set, get) => ({
  page: "dashboard",
  setPage: (page) => set({ page }),

  mode: "simulate",
  fsHz: 256,

  museConnState: "disconnected",
  museDeviceName: null,
  museBatteryPercent: null,
  museError: null,

  esp32ConnState: "disconnected",
  esp32CommHealthy: false,
  esp32OutputArmed: false,
  esp32LastCommandSent: null,
  esp32LastCommandTimeMs: null,
  esp32Error: null,

  config: defaultConfig(),
  calibrationStats: defaultCalibrationStats(),

  recentResults: [],
  recentRawSamples: [],
  maxRecentResults: MAX_RECENT_RESULTS,

  latestCommand: "HOLD",
  latestConfidence: null,
  latencySummary: {},

  isRecording: false,
  recordedRows: [],

  diagnosticsLog: [],

  setMode: (mode) => set({ mode }),
  setMuseConnState: (museConnState, deviceName) =>
    set({ museConnState, ...(deviceName !== undefined ? { museDeviceName: deviceName } : {}) }),
  setMuseBattery: (museBatteryPercent) => set({ museBatteryPercent }),
  setMuseError: (museError) => set({ museError }),
  setEsp32ConnState: (esp32ConnState) => set({ esp32ConnState }),
  setEsp32CommHealthy: (esp32CommHealthy) => set({ esp32CommHealthy }),
  setEsp32OutputArmed: (esp32OutputArmed) => set({ esp32OutputArmed }),
  setEsp32LastCommand: (esp32LastCommandSent, esp32LastCommandTimeMs) =>
    set({ esp32LastCommandSent, esp32LastCommandTimeMs }),
  setEsp32Error: (esp32Error) => set({ esp32Error }),
  setConfig: (config) => set({ config }),
  setCalibrationStats: (calibrationStats) => set({ calibrationStats }),

  pushResults: (results, rawSamples) => {
    if (results.length === 0) return;
    const last = results[results.length - 1];
    const lastWithEvent = [...results].reverse().find((r) => r.stateEvent !== null);

    set((state) => {
      const combinedResults = state.recentResults.length + results.length > state.maxRecentResults
        ? [...state.recentResults, ...results].slice(-state.maxRecentResults)
        : [...state.recentResults, ...results];
      const combinedRaw = state.recentRawSamples.length + rawSamples.length > state.maxRecentResults
        ? [...state.recentRawSamples, ...rawSamples].slice(-state.maxRecentResults)
        : [...state.recentRawSamples, ...rawSamples];
      return {
        recentResults: combinedResults,
        recentRawSamples: combinedRaw,
        latestCommand: last.gateDecision.command,
        latestConfidence: lastWithEvent?.classification?.confidence ?? state.latestConfidence,
      };
    });

    if (get().isRecording) {
      const rows: RecordRow[] = results.map((r, i) => {
        const raw = rawSamples[i];
        return {
          timestamp: r.timestampS,
          af7: raw?.af7 ?? NaN,
          af8: raw?.af8 ?? NaN,
          tp9: raw?.tp9 ?? NaN,
          tp10: raw?.tp10 ?? NaN,
          accelX: raw?.accelX ?? null,
          accelY: raw?.accelY ?? null,
          accelZ: raw?.accelZ ?? null,
          filteredAf7: r.filteredAf7,
          filteredAf8: r.filteredAf8,
          derivedFrontalSignal: r.frontalSignal,
          signalQuality: r.signalQuality.quality,
          candidateActive: r.candidate !== null,
          classificationValid: r.classification?.isValidBlink ?? null,
          confidence: r.classification?.confidence ?? null,
          stateEvent: r.stateEvent?.eventType ?? "",
          command: r.gateDecision.command,
        };
      });
      get().appendRecordedRows(rows);
    }
  },

  setLatencySummary: (latencySummary) => set({ latencySummary }),

  startRecording: () => set({ isRecording: true, recordedRows: [] }),
  stopRecording: () => set({ isRecording: false }),
  appendRecordedRows: (rows) => set((state) => ({ recordedRows: [...state.recordedRows, ...rows] })),
  clearRecording: () => set({ recordedRows: [] }),

  logDiagnostic: (line) =>
    set((state) => ({ diagnosticsLog: [...state.diagnosticsLog.slice(-499), `[${new Date().toISOString()}] ${line}`] })),

  reset: () =>
    set({
      recentResults: [],
      recentRawSamples: [],
      latestCommand: "HOLD",
      latestConfidence: null,
      latencySummary: {},
    }),
}));
