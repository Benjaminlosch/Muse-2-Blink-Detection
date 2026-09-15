// The full real-time blink pipeline for standalone (Mode B) operation —
// port of pipeline.py's BlinkPipeline / web/src/core/pipeline.ts. This is
// the single entry point: processSample() runs the exact same sequence of
// stages as the Python/TypeScript references (filter -> spatial -> signal
// quality -> motion veto -> candidate detection -> features -> classify ->
// double-blink timing -> confidence gate), so a command produced here
// should match what the PC/browser pipeline would have produced for the
// same input — see docs/WEB_DSP_EQUIVALENCE.md for how that claim is
// actually checked on the Python/TypeScript side. There is currently no
// automated cross-check of THIS port against the others (see
// docs/TESTING.md "Known gap") — it is a careful line-by-line translation,
// not independently verified against a golden run the way the DSP chain is.
#pragma once

#include "blink_classifier.h"
#include "blink_state_machine.h"
#include "candidate_detector.h"
#include "command_mapper.h"
#include "confidence_gate.h"
#include "dsp.h"
#include "motion_veto.h"
#include "pipeline_config.h"
#include "signal_quality.h"

namespace bcihand {

struct Sample {
  double timestampS;
  double af7;
  double af8;
  double tp9;
  double tp10;
  bool hasAccel = false;
  double accelX = 0, accelY = 0, accelZ = 0;
};

// Reads one of Sample's four raw EEG fields by ChannelId — the indirection
// that lets PipelineConfig::primaryChannelA/B pick which two physical
// electrodes feed detection. Port of pipeline.py's _channel_value /
// pipeline.ts's channelValue.
inline double channelValue(const Sample& sample, ChannelId channel) {
  switch (channel) {
    case ChannelId::kAf7: return sample.af7;
    case ChannelId::kAf8: return sample.af8;
    case ChannelId::kTp9: return sample.tp9;
    case ChannelId::kTp10: return sample.tp10;
  }
  return sample.af7;
}

struct PipelineStepResult {
  double timestampS;
  double filteredAf7;
  double filteredAf8;
  double frontalSignal;
  SignalQualityStatus signalQuality;
  double adaptiveThreshold;
  bool hasCandidate;
  bool hasClassification;
  ClassificationResult classification;
  bool hasStateEvent;
  BlinkStateMachineEvent stateEvent;
  GateDecision gateDecision;
};

// commOkProvider: nullptr means "always healthy" (matches the Python/TS
// default for pure-standalone runs with no separate comm link to check).
class BlinkPipeline {
 public:
  BlinkPipeline(const PipelineConfig& config, bool (*commOkProvider)() = nullptr);

  PipelineStepResult processSample(const Sample& sample);

  void setCalibration(double noiseFloorMedian, double noiseFloorMad) {
    calibration_.noiseFloorMedian = noiseFloorMedian;
    calibration_.noiseFloorMad = noiseFloorMad;
  }

 private:
  PipelineConfig config_;
  bool (*commOkProvider_)();

  CausalBlinkBandFilter filterAf7_;
  CausalBlinkBandFilter filterAf8_;
  CandidateDetector candidateDetector_;
  BlinkStateMachine stateMachine_;
  SignalQualityMonitor sqMonitorAf7_;
  SignalQualityMonitor sqMonitorAf8_;
  MotionVetoMonitor motionVeto_;
  HandStateTracker handState_;
  CalibrationStats calibration_;

  bool hasLastValidBlinkTime_ = false;
  double lastValidBlinkTimeS_ = 0.0;
};

}  // namespace bcihand
