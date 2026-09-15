#include "blink_pipeline.h"

#include <algorithm>

#include "features.h"
#include "spatial.h"

namespace bcihand {

namespace {
constexpr double kInfinity = 1e300;  // "no previous valid blink yet" sentinel, mirrors Python's float('inf')
}  // namespace

BlinkPipeline::BlinkPipeline(const PipelineConfig& config, bool (*commOkProvider)())
    : config_(config),
      commOkProvider_(commOkProvider),
      filterAf7_(config.baselineTrackerTimeConstantS, config.notchEnabled),
      filterAf8_(config.baselineTrackerTimeConstantS, config.notchEnabled),
      candidateDetector_(config.fsHz, config.minBlinkWidthS, config.maxBlinkWidthS, config.refractoryAfterCandidateS,
                          /*releaseRatio=*/0.35, /*thresholdWindowS=*/10.0, config.thresholdMadMultiplier,
                          config.reboundGuardS, config.reboundRefractoryS),
      stateMachine_(config.doubleBlinkMinIntervalS, config.doubleBlinkMaxIntervalS,
                    config.doubleBlinkWaitForSecondTimeoutS, config.doubleBlinkRefractoryAfterDoubleS),
      sqMonitorAf7_(config.fsHz),
      sqMonitorAf8_(config.fsHz),
      motionVeto_(config.fsHz, /*windowS=*/0.5, config.motionVetoAccelEnergyThresholdG2) {
  calibration_.noiseFloorMedian = config.calibrationNoiseFloorMedian;
  calibration_.noiseFloorMad = config.calibrationNoiseFloorMad;
}

PipelineStepResult BlinkPipeline::processSample(const Sample& sample) {
  double filteredAf7 = filterAf7_.processSample(sample.af7);
  double filteredAf8 = filterAf8_.processSample(sample.af8);
  double frontal = frontalMean(filteredAf7, filteredAf8);

  SignalQualityStatus sqAf7 = sqMonitorAf7_.update(sample.af7);
  SignalQualityStatus sqAf8 = sqMonitorAf8_.update(sample.af8);
  SignalQualityStatus signalQuality;
  signalQuality.quality = std::min(sqAf7.quality, sqAf8.quality);
  signalQuality.flatline = sqAf7.flatline || sqAf8.flatline;
  signalQuality.railed = sqAf7.railed || sqAf8.railed;
  signalQuality.excessiveNoise = sqAf7.excessiveNoise || sqAf8.excessiveNoise;

  double motionEnergy = motionVeto_.update(sample.hasAccel, sample.accelX, sample.accelY, sample.accelZ);

  BlinkCandidate candidate;
  bool hasCandidate = candidateDetector_.processSample(frontal, filteredAf7, filteredAf8, &candidate);

  bool hasClassification = false;
  ClassificationResult classification{};
  bool hasStateEvent = false;
  BlinkStateMachineEvent stateEvent{};

  if (hasCandidate) {
    double timeSincePrev = hasLastValidBlinkTime_ ? (sample.timestampS - lastValidBlinkTimeS_) : kInfinity;

    BlinkFeatures features = extractFeatures(candidate.frontalWindow, candidate.af7Window, candidate.af8Window,
                                               candidate.windowLength, config_.fsHz,
                                               candidateDetector_.threshold.noiseFloorMedian(), timeSincePrev,
                                               config_.af7Af8MinCorrelation, config_.af7Af8MaxAmplitudeRatio);

    bool motionVetoActive = config_.motionVetoEnabled && motionVeto_.isMotionArtifact(motionEnergy);

    ClassifyOptions classifyOptions;
    classifyOptions.minProminenceUv = config_.minProminenceUv;
    classifyOptions.minBlinkWidthS = config_.minBlinkWidthS;
    classifyOptions.maxBlinkWidthS = config_.maxBlinkWidthS;
    classifyOptions.af7Af8MinCorrelation = config_.af7Af8MinCorrelation;
    classifyOptions.af7Af8MaxAmplitudeRatio = config_.af7Af8MaxAmplitudeRatio;
    classifyOptions.minSignalQuality = config_.minSignalQuality;
    classifyOptions.motionVetoActive = motionVetoActive;
    classifyOptions.motionVetoConfidencePenalty = config_.motionVetoConfidencePenalty;

    classification = classifyCandidate(candidate, features, signalQuality, calibration_, classifyOptions);
    hasClassification = true;

    if (classification.isValidBlink) {
      hasStateEvent = stateMachine_.processValidBlink(sample.timestampS, classification.confidence, &stateEvent);
      lastValidBlinkTimeS_ = sample.timestampS;
      hasLastValidBlinkTime_ = true;
    }
  } else {
    hasStateEvent = stateMachine_.pollTimeout(sample.timestampS, &stateEvent);
  }

  bool signalQualityOk =
      signalQuality.quality >= config_.minSignalQuality && !signalQuality.flatline && !signalQuality.railed;
  bool commOk = commOkProvider_ ? commOkProvider_() : true;

  // Fixed mapping — only a high-confidence double blink ever controls the
  // hand; a single blink is detected but deliberately never mapped to a
  // command (see docs/CALIBRATION.md for why). This is a design decision,
  // not a calibration-tunable setting.
  GateDecision gateDecision = gateEvent(hasStateEvent, stateEvent, signalQualityOk, commOk,
                                          config_.highConfidenceThreshold, config_.mediumConfidenceThreshold,
                                          MappedIntent::kToggleOpenClose, MappedIntent::kHold, handState_);

  PipelineStepResult result;
  result.timestampS = sample.timestampS;
  result.filteredAf7 = filteredAf7;
  result.filteredAf8 = filteredAf8;
  result.frontalSignal = frontal;
  result.signalQuality = signalQuality;
  result.adaptiveThreshold = candidateDetector_.threshold.threshold();
  result.hasCandidate = hasCandidate;
  result.hasClassification = hasClassification;
  result.classification = classification;
  result.hasStateEvent = hasStateEvent;
  result.stateEvent = stateEvent;
  result.gateDecision = gateDecision;
  return result;
}

}  // namespace bcihand
