// Interpretable, rule-based single-blink-candidate classifier — port of
// classification/blink_classifier.py / web/src/core/classification/blinkClassifier.ts.
// A hard rejection (any gate fails) always wins over the soft confidence
// combination. This is a starting heuristic (see the Python/TS module
// docstrings), not derived from real user data yet.
#pragma once

#include "candidate_detector.h"
#include "features.h"
#include "signal_quality.h"

namespace bcihand {

// Only the fields the classifier's soft-confidence scoring actually
// consumes — populate from the website's calibration export (see
// docs/CALIBRATION.md / the Calibration page's "Export ESP32 Config").
struct CalibrationStats {
  double noiseFloorMedian = 0.0;
  double noiseFloorMad = 0.0;
};

struct ClassificationResult {
  bool isValidBlink;
  double confidence;
  // Bitmask of RejectionReason values (see below) — embedded-friendly
  // alternative to a dynamic list of strings.
  unsigned int rejectionReasons;
};

enum RejectionReason : unsigned int {
  kNone = 0,
  kDurationOutOfRange = 1u << 0,
  kFilterReboundBounce = 1u << 1,
  kElectrodeDropoutFlatline = 1u << 2,
  kRailedOrOversizedTransient = 1u << 3,
  kPoorSignalQuality = 1u << 4,
  kInsufficientProminence = 1u << 5,
  kAf7Af8DisagreementCorrelation = 1u << 6,
  kAf7Af8DisagreementAmplitudeRatio = 1u << 7,
  kDegenerateRiseFallShape = 1u << 8,
};

struct ClassifyOptions {
  double minProminenceUv;
  double minBlinkWidthS;
  double maxBlinkWidthS;
  double af7Af8MinCorrelation;
  double af7Af8MaxAmplitudeRatio;
  double minSignalQuality;
  bool motionVetoActive = false;
  double motionVetoConfidencePenalty = 0.5;
};

ClassificationResult classifyCandidate(const BlinkCandidate& candidate, const BlinkFeatures& features,
                                          const SignalQualityStatus& signalQuality,
                                          const CalibrationStats& calibration, const ClassifyOptions& options);

}  // namespace bcihand
