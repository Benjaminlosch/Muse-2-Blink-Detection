/**
 * Typed message contracts between the main thread and pipeline.worker.ts.
 * High-rate EEG processing runs in the worker (project brief section 8);
 * the main thread only ever receives batched, UI-rate results.
 */
import type { BciConfig } from "../core/config";
import type { CalibrationStats, PipelineStepResult, Sample } from "../core/types";

export interface WorkerInitMessage {
  type: "init";
  config: BciConfig;
  fsHz: number;
}

export interface WorkerSamplesMessage {
  type: "samples";
  samples: Sample[];
}

export interface WorkerSetConfigMessage {
  type: "setConfig";
  config: BciConfig;
}

export interface WorkerSetCalibrationMessage {
  type: "setCalibration";
  stats: CalibrationStats;
}

export interface WorkerSetCommOkMessage {
  type: "setCommOk";
  commOk: boolean;
}

export interface WorkerResetMessage {
  type: "reset";
}

export type MainToWorkerMessage =
  | WorkerInitMessage
  | WorkerSamplesMessage
  | WorkerSetConfigMessage
  | WorkerSetCalibrationMessage
  | WorkerSetCommOkMessage
  | WorkerResetMessage;

export interface WorkerResultsMessage {
  type: "results";
  results: PipelineStepResult[];
  /** The raw (pre-filter) samples that produced `results`, same length and
   * order — kept separate from PipelineStepResult (the Python-equivalence-
   * verified core type, see core/pipeline.test.ts) purely for the Live EEG
   * page's raw/filtered toggle. */
  rawSamples: Sample[];
  latencySummary: Record<string, { n: number; meanMs: number; medianMs: number; p95Ms: number; maxMs: number }>;
}

export type WorkerToMainMessage = WorkerResultsMessage;
