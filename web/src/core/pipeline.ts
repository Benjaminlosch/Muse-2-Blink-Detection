/**
 * The full real-time blink pipeline — port of pipeline.py's BlinkPipeline.
 * `BlinkPipeline.processSample()` is the single entry point used by the
 * Web Worker (worker/pipeline.worker.ts) and by every equivalence test in
 * core/pipeline.test.ts — the exact same code path runs whether samples
 * come from the real Muse 2, the browser's own simulator, or a replayed
 * recording.
 */
import type { BciConfig } from "./config";
import { classifyCandidate } from "./classification/blinkClassifier";
import { gateEvent } from "./classification/confidenceGate";
import { HandStateTracker } from "./classification/commandMapper";
import { DoubleBlinkStateMachine } from "./classification/stateMachine";
import { CandidateDetector } from "./detection/candidateDetector";
import { extractFeatures } from "./detection/features";
import { MotionVetoMonitor } from "./detection/motionVeto";
import { SignalQualityMonitor } from "./detection/signalQuality";
import { CausalBlinkBandFilter } from "./dsp/filters";
import { frontalMean } from "./dsp/spatial";
import type {
  BlinkCandidate,
  BlinkFeatures,
  BlinkStateMachineEvent,
  CalibrationStats,
  ClassificationResult,
  GateDecision,
  Sample,
  SignalQualityStatus,
} from "./types";
import { defaultCalibrationStats } from "./types";
import { LatencyProfiler } from "./utils/latency";

export interface PipelineStepResult {
  timestampS: number;
  filteredAf7: number;
  filteredAf8: number;
  frontalSignal: number;
  signalQuality: SignalQualityStatus;
  adaptiveThreshold: number;
  candidate: BlinkCandidate | null;
  features: BlinkFeatures | null;
  classification: ClassificationResult | null;
  stateEvent: BlinkStateMachineEvent | null;
  gateDecision: GateDecision;
}

const nowS = (): number => performance.now() / 1000;

const VALID_CHANNEL_NAMES = new Set(["af7", "af8", "tp9", "tp10"]);

/** Reads one of Sample's four raw EEG fields by name (case-insensitive) —
 * the indirection that lets acquisition.primaryChannels pick which two
 * physical electrodes feed detection, per-user, without touching any
 * downstream DSP/detection/classification code (those only ever see
 * "channel A" / "channel B", never a hardcoded electrode). Port of
 * pipeline.py's _channel_value. */
export function channelValue(sample: Sample, channelName: string): number {
  const key = channelName.trim().toLowerCase();
  if (!VALID_CHANNEL_NAMES.has(key)) {
    throw new Error(`Unknown channel '${channelName}'; must be one of af7, af8, tp9, tp10`);
  }
  return sample[key as "af7" | "af8" | "tp9" | "tp10"];
}

export class BlinkPipeline {
  readonly fsHz: number;
  private readonly config: BciConfig;
  private readonly commOkProvider: () => boolean;

  private readonly filterAf7: CausalBlinkBandFilter;
  private readonly filterAf8: CausalBlinkBandFilter;
  private readonly candidateDetector: CandidateDetector;
  private readonly stateMachine: DoubleBlinkStateMachine;
  private readonly sqMonitorAf7: SignalQualityMonitor;
  private readonly sqMonitorAf8: SignalQualityMonitor;
  private readonly motionVeto: MotionVetoMonitor;
  private readonly handState = new HandStateTracker();
  private calibrationStats: CalibrationStats;
  private lastValidBlinkTime: number | null = null;
  readonly latency = new LatencyProfiler();
  private readonly channelA: string;
  private readonly channelB: string;

  constructor(config: BciConfig, fsHz: number, commOkProvider?: () => boolean, calibrationStats?: CalibrationStats) {
    this.config = config;
    this.fsHz = fsHz;
    this.commOkProvider = commOkProvider ?? (() => true);
    this.calibrationStats = calibrationStats ?? defaultCalibrationStats();

    // Which two raw channels feed detection — see channelValue() above and
    // docs/CALIBRATION.md "Channel selection". Defaults to AF7/AF8, but is a
    // per-user/per-headset choice, not a fixed physiological fact.
    const primary = config.acquisition.primaryChannels;
    if (primary.length !== 2) {
      throw new Error(`acquisition.primaryChannels must have exactly 2 entries, got ${JSON.stringify(primary)}`);
    }
    for (const name of primary) {
      if (!VALID_CHANNEL_NAMES.has(name.trim().toLowerCase())) {
        throw new Error(`Unknown channel '${name}' in acquisition.primaryChannels; must be one of af7, af8, tp9, tp10`);
      }
    }
    [this.channelA, this.channelB] = primary;

    const dsp = config.dsp;
    this.filterAf7 = new CausalBlinkBandFilter(fsHz, dsp.baselineTrackerTimeConstantS, dsp.notchEnabled);
    this.filterAf8 = new CausalBlinkBandFilter(fsHz, dsp.baselineTrackerTimeConstantS, dsp.notchEnabled);

    const cd = config.candidateDetection;
    this.candidateDetector = new CandidateDetector({
      fsHz,
      minBlinkWidthS: cd.minBlinkWidthS,
      maxBlinkWidthS: cd.maxBlinkWidthS,
      refractoryAfterCandidateS: cd.refractoryAfterCandidateS,
      thresholdMadMultiplier: cd.thresholdMadMultiplier,
      reboundGuardS: cd.reboundGuardS,
      reboundRefractoryS: cd.reboundRefractoryS,
    });

    const db = config.doubleBlink;
    this.stateMachine = new DoubleBlinkStateMachine({
      minIntervalS: db.minIntervalS,
      maxIntervalS: db.maxIntervalS,
      waitForSecondTimeoutS: db.waitForSecondTimeoutS,
      refractoryAfterDoubleS: db.refractoryAfterDoubleS,
    });

    this.sqMonitorAf7 = new SignalQualityMonitor(fsHz);
    this.sqMonitorAf8 = new SignalQualityMonitor(fsHz);
    this.motionVeto = new MotionVetoMonitor(fsHz, 0.5, config.motionVeto.accelEnergyThresholdG2);
  }

  setCalibrationStats(stats: CalibrationStats): void {
    this.calibrationStats = stats;
  }

  processSample(sample: Sample): PipelineStepResult {
    const tIngest = nowS();

    const rawA = channelValue(sample, this.channelA);
    const rawB = channelValue(sample, this.channelB);
    const filteredAf7 = this.filterAf7.processSample(rawA);
    const filteredAf8 = this.filterAf8.processSample(rawB);
    const frontal = frontalMean(filteredAf7, filteredAf8);
    const tFiltered = nowS();
    this.latency.record("filtering", tFiltered - tIngest);

    const sqAf7 = this.sqMonitorAf7.update(rawA);
    const sqAf8 = this.sqMonitorAf8.update(rawB);
    const signalQuality: SignalQualityStatus = {
      quality: Math.min(sqAf7.quality, sqAf8.quality),
      flatline: sqAf7.flatline || sqAf8.flatline,
      railed: sqAf7.railed || sqAf8.railed,
      excessiveNoise: sqAf7.excessiveNoise || sqAf8.excessiveNoise,
    };

    const motionEnergy = this.motionVeto.update(sample.accelX, sample.accelY, sample.accelZ);

    const candidate = this.candidateDetector.processSample(frontal, filteredAf7, filteredAf8);
    const tCandidate = nowS();
    this.latency.record("candidate_detection", tCandidate - tFiltered);

    let features: BlinkFeatures | null = null;
    let classification: ClassificationResult | null = null;
    let stateEvent: BlinkStateMachineEvent | null = null;

    if (candidate !== null) {
      const timeSincePrev = this.lastValidBlinkTime !== null ? sample.timestampS - this.lastValidBlinkTime : Infinity;
      const spatial = this.config.spatial;
      features = extractFeatures(
        candidate.frontalWindow, candidate.af7Window, candidate.af8Window, this.fsHz,
        this.candidateDetector.threshold.noiseFloorMedian, timeSincePrev,
        spatial.af7Af8MinCorrelation, spatial.af7Af8MaxAmplitudeRatio,
      );

      const motionVetoActive = this.config.motionVeto.enabled && this.motionVeto.isMotionArtifact(motionEnergy);

      const cd = this.config.candidateDetection;
      classification = classifyCandidate(candidate, features, signalQuality, this.calibrationStats, {
        minProminenceUv: cd.minProminenceUv,
        minBlinkWidthS: cd.minBlinkWidthS,
        maxBlinkWidthS: cd.maxBlinkWidthS,
        af7Af8MinCorrelation: spatial.af7Af8MinCorrelation,
        af7Af8MaxAmplitudeRatio: spatial.af7Af8MaxAmplitudeRatio,
        minSignalQuality: this.config.confidence.minSignalQuality,
        motionVetoActive,
        motionVetoConfidencePenalty: this.config.motionVeto.confidencePenalty,
      });
      const tClassified = nowS();
      this.latency.record("classification", tClassified - tCandidate);

      if (classification.isValidBlink) {
        stateEvent = this.stateMachine.processValidBlink(sample.timestampS, classification.confidence);
        this.lastValidBlinkTime = sample.timestampS;
      }
    } else {
      stateEvent = this.stateMachine.pollTimeout(sample.timestampS);
    }

    const tState = nowS();
    if (stateEvent !== null) this.latency.record("double_blink_confirmation", tState - tCandidate);

    const signalQualityOk =
      signalQuality.quality >= this.config.confidence.minSignalQuality && !signalQuality.flatline && !signalQuality.railed;
    const commOk = this.commOkProvider();

    const gateDecision = gateEvent(
      stateEvent, signalQualityOk, commOk,
      this.config.confidence.highConfidenceThreshold, this.config.confidence.mediumConfidenceThreshold,
      this.config.communication.commandMapping as unknown as Record<string, string>,
      this.handState,
    );

    if (stateEvent !== null) this.latency.recordTotal(tState - tIngest);

    return {
      timestampS: sample.timestampS,
      filteredAf7,
      filteredAf8,
      frontalSignal: frontal,
      signalQuality,
      adaptiveThreshold: this.candidateDetector.threshold.threshold,
      candidate,
      features,
      classification,
      stateEvent,
      gateDecision,
    };
  }
}
