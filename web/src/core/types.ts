/**
 * Shared types for the TypeScript port of the Python reference pipeline
 * (src/bcihand/). Python is the golden reference — see
 * docs/WEB_DSP_EQUIVALENCE.md. Field names intentionally mirror the Python
 * dataclasses (camelCase instead of snake_case) so the correspondence stays
 * obvious on inspection.
 */

/** Mirrors acquisition/base.py's Sample dataclass. */
export interface Sample {
  timestampS: number;
  af7: number;
  af8: number;
  tp9: number;
  tp10: number;
  accelX?: number | null;
  accelY?: number | null;
  accelZ?: number | null;
}

export type PeakSign = 1 | -1;

/** Mirrors detection/candidate_detector.py's BlinkCandidate. */
export interface BlinkCandidate {
  startIdx: number;
  endIdx: number;
  startTimeS: number;
  endTimeS: number;
  durationS: number;
  frontalWindow: Float64Array;
  af7Window: Float64Array;
  af8Window: Float64Array;
  thresholdAtDetection: number;
  widthValid: boolean;
  peakSign: PeakSign;
  likelyFilterRebound: boolean;
}

/** Mirrors detection/features.py's BlinkFeatures. */
export interface BlinkFeatures {
  peakAmplitude: number;
  absPeakAmplitude: number;
  peakProminence: number;
  positiveExcursion: number;
  negativeExcursion: number;
  peakToPeakAmplitude: number;
  durationS: number;
  riseTimeS: number;
  fallTimeS: number;
  maxSlope: number;
  areaUnderCurve: number;
  rms: number;
  signalEnergy: number;
  af7Af8Correlation: number;
  af7Af8AmplitudeRatio: number;
  baselineDeviation: number;
  timeSincePreviousValidBlinkS: number;
}

/** Mirrors detection/signal_quality.py's SignalQualityStatus. */
export interface SignalQualityStatus {
  quality: number;
  flatline: boolean;
  railed: boolean;
  excessiveNoise: boolean;
}

/** Mirrors classification/blink_classifier.py's ClassificationResult. */
export interface ClassificationResult {
  isValidBlink: boolean;
  confidence: number;
  rejectionReasons: string[];
  componentScores: Record<string, number>;
}

export type BlinkEventType = "SINGLE_BLINK_CONFIRMED" | "DOUBLE_BLINK_CONFIRMED";

/** Mirrors classification/state_machine.py's BlinkStateMachineEvent. */
export interface BlinkStateMachineEvent {
  eventType: BlinkEventType;
  timestampS: number;
  firstBlinkTimestampS: number;
  secondBlinkTimestampS: number | null;
  interBlinkIntervalS: number | null;
  confidence: number;
}

export type Command = "OPEN" | "CLOSE" | "HOLD";
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "NONE";

/** Mirrors classification/confidence_gate.py's GateDecision. */
export interface GateDecision {
  command: Command;
  confidenceLevel: ConfidenceLevel;
  reason: string;
}

/** Mirrors detection/calibration.py's CalibrationStats (subset actually
 * consumed by the classifier's soft-confidence scoring). */
export interface CalibrationStats {
  baselineMedian: number;
  baselineMad: number;
  noiseFloorMedian: number;
  noiseFloorMad: number;
  normalBlinkPeakMedian: number;
  normalBlinkPeakMad: number;
  nRestCandidates: number;
  intentionalBlinkPeakMedian: number;
  intentionalBlinkPeakMad: number;
  intentionalDurationMedianS: number;
  intentionalDurationMadS: number;
  intentionalRiseTimeMedianS: number;
  intentionalFallTimeMedianS: number;
  nSingleCandidates: number;
  doubleBlinkSpacingMedianS: number;
  doubleBlinkSpacingMadS: number;
  nDoublePairs: number;
  // The *actual* classifier-equivalent prominence/duration of each
  // DOUBLE_BLINK trial's second pulse — directly measured (not guessed
  // from single-blink amplitude), used as a hard ceiling in
  // deriveConfigOverrides so calibration can never derive a threshold that
  // would reject the very double blinks it just verified. 0 means "no
  // double-blink trial data" (e.g. a calibration saved before this field
  // existed).
  doubleBlinkSecondPulseProminenceMedian: number;
  doubleBlinkSecondPulseProminenceMad: number;
  doubleBlinkSecondPulseDurationMedianS: number;
  doubleBlinkSecondPulseDurationMadS: number;
  nRestTrials: number;
  nSingleTrials: number;
  nDoubleTrials: number;
}

export function defaultCalibrationStats(): CalibrationStats {
  return {
    baselineMedian: 0, baselineMad: 0, noiseFloorMedian: 0, noiseFloorMad: 0,
    normalBlinkPeakMedian: 0, normalBlinkPeakMad: 0, nRestCandidates: 0,
    intentionalBlinkPeakMedian: 0, intentionalBlinkPeakMad: 0,
    intentionalDurationMedianS: 0, intentionalDurationMadS: 0,
    intentionalRiseTimeMedianS: 0, intentionalFallTimeMedianS: 0, nSingleCandidates: 0,
    doubleBlinkSpacingMedianS: 0, doubleBlinkSpacingMadS: 0, nDoublePairs: 0,
    doubleBlinkSecondPulseProminenceMedian: 0, doubleBlinkSecondPulseProminenceMad: 0,
    doubleBlinkSecondPulseDurationMedianS: 0, doubleBlinkSecondPulseDurationMadS: 0,
    nRestTrials: 0, nSingleTrials: 0, nDoubleTrials: 0,
  };
}

/** One full pipeline step output. Mirrors pipeline.py's PipelineStepResult. */
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
