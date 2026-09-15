#include "candidate_detector.h"

#include <algorithm>
#include <cmath>

namespace bcihand {

CandidateDetector::CandidateDetector(double fsHz, double minBlinkWidthS, double maxBlinkWidthS,
                                       double refractoryAfterCandidateS, double releaseRatio,
                                       double thresholdWindowS, double thresholdMadMultiplier,
                                       double reboundGuardS, double reboundRefractoryS)
    : threshold(fsHz, thresholdWindowS, thresholdMadMultiplier),
      fsHz_(fsHz),
      dt_(1.0 / fsHz),
      releaseRatio_(releaseRatio),
      reboundGuardS_(reboundGuardS) {
  minWidthSamples_ = std::max(static_cast<int>(minBlinkWidthS * fsHz), 1);
  maxWidthSamples_ = std::max(static_cast<int>(maxBlinkWidthS * fsHz), minWidthSamples_ + 1);
  refractorySamples_ = static_cast<int>(refractoryAfterCandidateS * fsHz);
  reboundRefractorySamples_ = std::max(static_cast<int>(reboundRefractoryS * fsHz), 1);

  eventCapacity_ = maxWidthSamples_ + 4;
  eventFrontal_ = new double[eventCapacity_];
  eventAf7_ = new double[eventCapacity_];
  eventAf8_ = new double[eventCapacity_];
}

CandidateDetector::~CandidateDetector() {
  delete[] eventFrontal_;
  delete[] eventAf7_;
  delete[] eventAf8_;
}

bool CandidateDetector::processSample(double frontal, double af7, double af8, BlinkCandidate* outCandidate) {
  sampleIdx_ += 1;
  long idx = sampleIdx_;

  bool inCandidate = (state_ == State::kAboveThreshold);
  double thr = threshold.update(std::fabs(frontal), inCandidate);

  bool emitted = false;

  if (state_ == State::kRefractory) {
    refractoryRemaining_ -= 1;
    if (refractoryRemaining_ <= 0) {
      if (pendingExtendedWait_) {
        if (std::fabs(frontal) < releaseRatio_ * thr) {
          state_ = State::kBelowThreshold;
          pendingExtendedWait_ = false;
        } else {
          refractoryRemaining_ = 1;
        }
      } else {
        state_ = State::kBelowThreshold;
      }
    }
    return false;
  }

  if (state_ == State::kBelowThreshold) {
    if (std::fabs(frontal) >= thr) {
      state_ = State::kAboveThreshold;
      eventStartIdx_ = idx;
      eventSign_ = (frontal >= 0) ? 1 : -1;
      eventLength_ = 0;
      if (eventLength_ < eventCapacity_) {
        eventFrontal_[eventLength_] = frontal;
        eventAf7_[eventLength_] = af7;
        eventAf8_[eventLength_] = af8;
        eventLength_++;
      }
    }
  } else if (state_ == State::kAboveThreshold) {
    if (eventLength_ < eventCapacity_) {
      eventFrontal_[eventLength_] = frontal;
      eventAf7_[eventLength_] = af7;
      eventAf8_[eventLength_] = af8;
      eventLength_++;
    }
    long width = idx - eventStartIdx_ + 1;

    bool crossedZero = (frontal * eventSign_) < 0;
    bool magnitudeReleased = std::fabs(frontal) < releaseRatio_ * thr;
    bool tooLong = width >= maxWidthSamples_;

    if (crossedZero || magnitudeReleased || tooLong) {
      bool truncated = tooLong && !(crossedZero || magnitudeReleased);
      *outCandidate = emitCandidate(thr, truncated);
      emitted = true;
      state_ = State::kRefractory;
      refractoryRemaining_ = outCandidate->likelyFilterRebound ? reboundRefractorySamples_ : refractorySamples_;
      pendingExtendedWait_ = truncated;
    }
  }

  return emitted;
}

BlinkCandidate CandidateDetector::emitCandidate(double thresholdAtDetection, bool truncated) {
  long startIdx = eventStartIdx_;
  long endIdx = startIdx + eventLength_ - 1;
  double endTimeS = endIdx * dt_;
  double durationS = (eventLength_ - 1) * dt_;

  int peakIdx = 0;
  double bestAbs = -1.0;
  for (int i = 0; i < eventLength_; i++) {
    double v = std::fabs(eventFrontal_[i]);
    if (v > bestAbs) {
      bestAbs = v;
      peakIdx = i;
    }
  }
  int peakSign = (eventFrontal_[peakIdx] >= 0) ? 1 : -1;

  bool widthValid = !truncated && eventLength_ >= minWidthSamples_ && eventLength_ <= maxWidthSamples_;

  bool likelyFilterRebound = false;
  if (hasLastAccepted_ && peakSign != lastAcceptedPeakSign_ &&
      (startIdx * dt_ - lastAcceptedEndTimeS_) <= reboundGuardS_) {
    likelyFilterRebound = true;
  }

  if (widthValid && !likelyFilterRebound) {
    lastAcceptedEndTimeS_ = endTimeS;
    lastAcceptedPeakSign_ = peakSign;
    hasLastAccepted_ = true;
  }

  BlinkCandidate c;
  c.startIdx = static_cast<int>(startIdx);
  c.endIdx = static_cast<int>(endIdx);
  c.startTimeS = startIdx * dt_;
  c.endTimeS = endTimeS;
  c.durationS = durationS;
  c.frontalWindow = eventFrontal_;
  c.af7Window = eventAf7_;
  c.af8Window = eventAf8_;
  c.windowLength = eventLength_;
  c.thresholdAtDetection = thresholdAtDetection;
  c.widthValid = widthValid;
  c.peakSign = peakSign;
  c.likelyFilterRebound = likelyFilterRebound;
  return c;
}

void CandidateDetector::reset() {
  state_ = State::kBelowThreshold;
  eventStartIdx_ = 0;
  refractoryRemaining_ = 0;
  pendingExtendedWait_ = false;
  hasLastAccepted_ = false;
  eventLength_ = 0;
}

}  // namespace bcihand
