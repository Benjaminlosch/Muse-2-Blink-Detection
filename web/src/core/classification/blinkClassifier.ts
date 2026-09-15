/**
 * Interpretable, rule-based single-blink-candidate classifier — port of
 * classification/blink_classifier.py. A hard rejection (any gate fails)
 * always wins over the soft confidence combination; see that file's module
 * docstring for the full rationale (this is a starting heuristic, not
 * derived from real user data yet).
 */
import type { BlinkCandidate, BlinkFeatures, CalibrationStats, ClassificationResult, SignalQualityStatus } from "../types";
import { MAD_TO_SIGMA } from "../detection/adaptiveThreshold";

function clip01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}

export interface ClassifyOptions {
  minProminenceUv: number;
  minBlinkWidthS: number;
  maxBlinkWidthS: number;
  af7Af8MinCorrelation: number;
  af7Af8MaxAmplitudeRatio: number;
  minSignalQuality: number;
  motionVetoActive?: boolean;
  motionVetoConfidencePenalty?: number;
}

export function classifyCandidate(
  candidate: BlinkCandidate,
  features: BlinkFeatures,
  signalQuality: SignalQualityStatus,
  calibration: CalibrationStats,
  options: ClassifyOptions,
): ClassificationResult {
  const {
    minProminenceUv, minBlinkWidthS, maxBlinkWidthS, af7Af8MinCorrelation, af7Af8MaxAmplitudeRatio,
    minSignalQuality, motionVetoActive = false, motionVetoConfidencePenalty = 0.5,
  } = options;

  const reasons: string[] = [];

  if (!candidate.widthValid || !(features.durationS >= minBlinkWidthS && features.durationS <= maxBlinkWidthS)) {
    reasons.push("duration_out_of_range");
  }
  if (candidate.likelyFilterRebound) reasons.push("filter_rebound_bounce");
  if (signalQuality.flatline) reasons.push("electrode_dropout_flatline");
  if (signalQuality.railed) reasons.push("railed_or_oversized_transient");
  if (signalQuality.quality < minSignalQuality) reasons.push("poor_signal_quality");
  if (features.peakProminence < minProminenceUv) reasons.push("insufficient_prominence");
  if (features.af7Af8Correlation < af7Af8MinCorrelation) reasons.push("af7_af8_disagreement_correlation");
  if (features.af7Af8AmplitudeRatio > af7Af8MaxAmplitudeRatio) reasons.push("af7_af8_disagreement_amplitude_ratio");
  if (features.riseTimeS <= 0 || features.fallTimeS <= 0) reasons.push("degenerate_rise_fall_shape");

  if (reasons.length > 0) {
    return { isValidBlink: false, confidence: 0, rejectionReasons: reasons, componentScores: {} };
  }

  const qualityScore = clip01(signalQuality.quality);

  const corrSpan = Math.max(1.0 - af7Af8MinCorrelation, 1e-6);
  const agreementCorrScore = clip01((features.af7Af8Correlation - af7Af8MinCorrelation) / corrSpan);
  const ratioSpan = Math.max(af7Af8MaxAmplitudeRatio - 1.0, 1e-6);
  const agreementRatioScore = clip01(1.0 - (features.af7Af8AmplitudeRatio - 1.0) / ratioSpan);
  const agreementScore = Math.sqrt(agreementCorrScore * agreementRatioScore);

  let prominenceScore: number;
  if (calibration.noiseFloorMad > 0) {
    const noiseSigma = calibration.noiseFloorMad * MAD_TO_SIGMA;
    const z = (features.peakProminence - calibration.noiseFloorMedian) / Math.max(noiseSigma, 1e-9);
    prominenceScore = clip01(z / 8.0);
  } else {
    prominenceScore = clip01(features.peakProminence / Math.max(minProminenceUv * 2.0, 1e-9));
  }

  const componentScores: Record<string, number> = {
    quality_score: qualityScore,
    agreement_score: agreementScore,
    prominence_score: prominenceScore,
  };
  let confidence = Math.cbrt(qualityScore * agreementScore * prominenceScore);

  if (motionVetoActive) {
    confidence *= 1.0 - motionVetoConfidencePenalty;
    componentScores.motion_veto_penalty_applied = motionVetoConfidencePenalty;
  }

  return { isValidBlink: true, confidence: clip01(confidence), rejectionReasons: [], componentScores };
}
