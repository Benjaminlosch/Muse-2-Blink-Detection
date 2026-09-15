/**
 * Dedicated Web Worker: owns the BlinkPipeline and runs it on every
 * incoming sample, off the main/UI thread (project brief section 8).
 * Results are batched and flushed at a bounded rate so the main thread
 * never has to process one postMessage per 256Hz EEG sample.
 */
/// <reference lib="webworker" />
import { BlinkPipeline } from "../core/pipeline";
import { defaultCalibrationStats, type CalibrationStats, type Sample } from "../core/types";
import type { MainToWorkerMessage, WorkerResultsMessage } from "./workerProtocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let pipeline: BlinkPipeline | null = null;
let commOk = true;
let currentCalibrationStats: CalibrationStats = defaultCalibrationStats();
let resultBuffer: ReturnType<BlinkPipeline["processSample"]>[] = [];
let rawSampleBuffer: Sample[] = [];

const FLUSH_INTERVAL_MS = 33; // ~30 FPS UI update rate; processing itself is not throttled

function flush(): void {
  if (!pipeline || resultBuffer.length === 0) return;
  const message: WorkerResultsMessage = {
    type: "results",
    results: resultBuffer,
    rawSamples: rawSampleBuffer,
    latencySummary: pipeline.latency.summary(),
  };
  resultBuffer = [];
  rawSampleBuffer = [];
  ctx.postMessage(message);
}

setInterval(flush, FLUSH_INTERVAL_MS);

ctx.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      pipeline = new BlinkPipeline(msg.config, msg.fsHz, () => commOk, currentCalibrationStats);
      resultBuffer = [];
      break;

    case "samples":
      if (!pipeline) break;
      for (const sample of msg.samples) {
        resultBuffer.push(pipeline.processSample(sample));
        rawSampleBuffer.push(sample);
      }
      // Bound memory if the main thread somehow stalls consuming results.
      if (resultBuffer.length > 5000) flush();
      break;

    case "setConfig":
      if (!pipeline) break;
      pipeline = new BlinkPipeline(msg.config, pipeline.fsHz, () => commOk, currentCalibrationStats);
      break;

    case "setCalibration":
      currentCalibrationStats = msg.stats;
      pipeline?.setCalibrationStats(msg.stats);
      break;

    case "setCommOk":
      commOk = msg.commOk;
      break;

    case "reset":
      resultBuffer = [];
      break;

    default:
      break;
  }
};
