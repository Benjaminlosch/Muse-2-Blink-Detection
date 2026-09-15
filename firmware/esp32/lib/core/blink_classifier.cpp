#include "blink_classifier.h"

#include <algorithm>
#include <cmath>

#include "adaptive_threshold.h"  // kMadToSigma

namespace bcihand {

namespace {
double clip01(double x) { return std::min(std::max(x, 0.0), 1.0); }
}  // namespace

ClassificationResult classifyCandidate(const BlinkCandidate& candidate, const BlinkFeatures& features,
                                          const SignalQualityStatus& signalQuality,
                                          const CalibrationStats& calibration, const ClassifyOptions& options) {
  unsigned int reasons = kNone;

  if (!candidate.widthValid ||
      !(features.durationS >= options.minBlinkWidthS && features.durationS <= options.maxBlinkWidthS)) {
    reasons |= kDurationOutOfRange;
  }
  if (candidate.likelyFilterRebound) reasons |= kFilterReboundBounce;
  if (signalQuality.flatline) reasons |= kElectrodeDropoutFlatline;
  if (signalQuality.railed) reasons |= kRailedOrOversizedTransient;
  if (signalQuality.quality < options.minSignalQuality) reasons |= kPoorSignalQuality;
  if (features.peakProminence < options.minProminenceUv) reasons |= kInsufficientProminence;
  if (features.af7Af8Correlation < options.af7Af8MinCorrelation) reasons |= kAf7Af8DisagreementCorrelation;
  if (features.af7Af8AmplitudeRatio > options.af7Af8MaxAmplitudeRatio) reasons |= kAf7Af8DisagreementAmplitudeRatio;
  if (features.riseTimeS <= 0 || features.fallTimeS <= 0) reasons |= kDegenerateRiseFallShape;

  if (reasons != kNone) {
    return {false, 0.0, reasons};
  }

  double qualityScore = clip01(signalQuality.quality);

  double corrSpan = std::max(1.0 - options.af7Af8MinCorrelation, 1e-6);
  double agreementCorrScore = clip01((features.af7Af8Correlation - options.af7Af8MinCorrelation) / corrSpan);
  double ratioSpan = std::max(options.af7Af8MaxAmplitudeRatio - 1.0, 1e-6);
  double agreementRatioScore = clip01(1.0 - (features.af7Af8AmplitudeRatio - 1.0) / ratioSpan);
  double agreementScore = std::sqrt(agreementCorrScore * agreementRatioScore);

  double prominenceScore;
  if (calibration.noiseFloorMad > 0) {
    double noiseSigma = calibration.noiseFloorMad * kMadToSigma;
    double z = (features.peakProminence - calibration.noiseFloorMedian) / std::max(noiseSigma, 1e-9);
    prominenceScore = clip01(z / 8.0);
  } else {
    prominenceScore = clip01(features.peakProminence / std::max(options.minProminenceUv * 2.0, 1e-9));
  }

  double confidence = std::cbrt(qualityScore * agreementScore * prominenceScore);

  if (options.motionVetoActive) {
    confidence *= (1.0 - options.motionVetoConfidencePenalty);
  }

  return {true, clip01(confidence), kNone};
}

}  // namespace bcihand
