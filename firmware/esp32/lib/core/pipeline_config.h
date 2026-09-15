// Standalone (Mode B) pipeline configuration — mirrors
// config/default_config.yaml / web/src/core/config.ts's defaults.
//
// THIS FILE GETS REPLACED BY CALIBRATION: the web app's Calibration page
// has an "Export ESP32 Config" button that generates a replacement for
// this exact file with your own tuned thresholds (see docs/CALIBRATION.md
// and docs/ESP32_SETUP.md "Mode B"). Calibrate on the website first, then
// download the generated pipeline_config.h and drop it in here before
// flashing — that's the entire "training" workflow: tune on the website,
// bake the result into the firmware, run standalone from then on.
#pragma once

namespace bcihand {

// Which physical Muse 2 electrode a "channel A"/"channel B" slot reads from
// — see PipelineConfig::primaryChannelA/B and Sample in blink_pipeline.h.
// Mirrors pipeline.py's _channel_value / pipeline.ts's channelValue.
enum class ChannelId { kAf7, kAf8, kTp9, kTp10 };

struct PipelineConfig {
  // acquisition
  double fsHz = 256.0;
  // Which two raw channels feed detection. AF7/AF8 (forehead) is the
  // anatomically conventional bilateral-ocular pair, but Muse 2's dry
  // forehead electrodes often make worse skin contact than the ear-clip
  // TP9/TP10 electrodes — pick whichever pair showed clean blinks on the
  // web app's Live EEG page during calibration (see docs/CALIBRATION.md
  // "Channel selection"). The web app's Export ESP32 Config bakes in
  // whatever was selected there.
  ChannelId primaryChannelA = ChannelId::kAf7;
  ChannelId primaryChannelB = ChannelId::kAf8;

  // dsp — baseline tracker only (bandpass/notch coefficients are fixed at
  // compile time in dsp_coeffs.h; see docs/TESTING.md for how to
  // regenerate those if config/default_config.yaml's dsp section changes)
  double baselineTrackerTimeConstantS = 4.0;
  bool notchEnabled = true;

  // spatial
  double af7Af8MinCorrelation = 0.6;
  double af7Af8MaxAmplitudeRatio = 3.0;

  // candidate_detection
  double thresholdMadMultiplier = 4.0;
  double minBlinkWidthS = 0.06;
  double maxBlinkWidthS = 0.4;
  double minProminenceUv = 20.0;
  double refractoryAfterCandidateS = 0.15;
  double reboundGuardS = 0.3;
  double reboundRefractoryS = 0.02;

  // double_blink
  double doubleBlinkMinIntervalS = 0.08;
  double doubleBlinkMaxIntervalS = 0.6;
  double doubleBlinkWaitForSecondTimeoutS = 0.7;
  double doubleBlinkRefractoryAfterDoubleS = 0.5;

  // confidence
  double highConfidenceThreshold = 0.80;
  double mediumConfidenceThreshold = 0.55;
  double minSignalQuality = 0.5;

  // motion_veto
  bool motionVetoEnabled = true;
  double motionVetoAccelEnergyThresholdG2 = 0.05;
  double motionVetoConfidencePenalty = 0.5;

  // calibration (from detection/calibration.py's CalibrationStats — only
  // the fields the classifier's soft-confidence scoring consumes; see
  // blink_classifier.h)
  double calibrationNoiseFloorMedian = 0.0;
  double calibrationNoiseFloorMad = 0.0;
};

// The active configuration. Uses PipelineConfig's own defaults above
// unless a calibration export has replaced this file's values.
inline const PipelineConfig& activePipelineConfig() {
  static const PipelineConfig kConfig{};
  return kConfig;
}

}  // namespace bcihand
