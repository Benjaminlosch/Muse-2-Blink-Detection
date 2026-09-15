// Causal streaming blink-candidate detector — port of
// detection/candidate_detector.py / web/src/core/detection/candidateDetector.ts.
// See either of those files' module docstrings for the full rationale
// (BELOW_THRESHOLD -> ABOVE_THRESHOLD -> REFRACTORY state machine,
// zero-crossing candidate boundaries, and filter-rebound rejection). This
// port preserves that logic exactly; nothing here is a fresh design.
#pragma once

#include "adaptive_threshold.h"

namespace bcihand {

struct BlinkCandidate {
  int startIdx;
  int endIdx;
  double startTimeS;
  double endTimeS;
  double durationS;
  // Points into CandidateDetector's own internal event buffer — valid
  // until the next processSample() call. The pipeline must extract
  // features/classify immediately after receiving a candidate, before
  // feeding the next sample (exactly how pipeline.py / pipeline.ts do it).
  const double* frontalWindow;
  const double* af7Window;
  const double* af8Window;
  int windowLength;
  double thresholdAtDetection;
  bool widthValid;
  int peakSign;  // +1 or -1
  bool likelyFilterRebound;
};

class CandidateDetector {
 public:
  CandidateDetector(double fsHz, double minBlinkWidthS = 0.06, double maxBlinkWidthS = 0.4,
                      double refractoryAfterCandidateS = 0.15, double releaseRatio = 0.35,
                      double thresholdWindowS = 10.0, double thresholdMadMultiplier = 4.0,
                      double reboundGuardS = 0.3, double reboundRefractoryS = 0.02);
  ~CandidateDetector();
  CandidateDetector(const CandidateDetector&) = delete;
  CandidateDetector& operator=(const CandidateDetector&) = delete;

  // Returns true and fills `outCandidate` if an event just completed.
  bool processSample(double frontal, double af7, double af8, BlinkCandidate* outCandidate);

  void reset();

  AdaptiveThreshold threshold;

 private:
  enum class State { kBelowThreshold, kAboveThreshold, kRefractory };

  double fsHz_;
  double dt_;
  int minWidthSamples_;
  int maxWidthSamples_;
  int refractorySamples_;
  double releaseRatio_;
  double reboundGuardS_;
  int reboundRefractorySamples_;

  State state_ = State::kBelowThreshold;
  long sampleIdx_ = -1;
  long eventStartIdx_ = 0;
  int eventSign_ = 1;
  int refractoryRemaining_ = 0;
  bool pendingExtendedWait_ = false;

  bool hasLastAccepted_ = false;
  double lastAcceptedEndTimeS_ = 0.0;
  int lastAcceptedPeakSign_ = 1;

  // Fixed-capacity event buffers, sized to maxWidthSamples_ + a small
  // margin, allocated once.
  double* eventFrontal_;
  double* eventAf7_;
  double* eventAf8_;
  int eventLength_ = 0;
  int eventCapacity_;

  BlinkCandidate emitCandidate(double thresholdAtDetection, bool truncated);
};

}  // namespace bcihand
