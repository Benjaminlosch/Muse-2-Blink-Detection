#include "blink_state_machine.h"

#include <algorithm>

namespace bcihand {

BlinkStateMachine::BlinkStateMachine(double minIntervalS, double maxIntervalS, double waitForSecondTimeoutS,
                                       double refractoryAfterDoubleS, bool emitSingleOnTimeout)
    : minIntervalS_(minIntervalS),
      maxIntervalS_(maxIntervalS),
      waitForSecondTimeoutS_(waitForSecondTimeoutS),
      refractoryAfterDoubleS_(refractoryAfterDoubleS),
      emitSingleOnTimeout_(emitSingleOnTimeout) {}

bool BlinkStateMachine::pollTimeout(double nowS, BlinkStateMachineEvent* outEvent) {
  if (state_ == State::kWaitForSecond && hasFirstBlinkTime_) {
    if (nowS - firstBlinkTimeS_ > waitForSecondTimeoutS_) {
      bool emitted = false;
      if (emitSingleOnTimeout_) {
        outEvent->eventType = BlinkEventType::kSingleBlinkConfirmed;
        outEvent->timestampS = nowS;
        outEvent->firstBlinkTimestampS = firstBlinkTimeS_;
        outEvent->hasSecondBlinkTimestamp = false;
        outEvent->hasInterBlinkInterval = false;
        outEvent->confidence = firstBlinkConfidence_;
        emitted = true;
      }
      toIdle();
      return emitted;
    }
  }

  if (state_ == State::kRefractory && hasRefractoryUntil_) {
    if (nowS >= refractoryUntilS_) {
      state_ = State::kIdle;
      hasRefractoryUntil_ = false;
    }
  }

  return false;
}

bool BlinkStateMachine::processValidBlink(double timestampS, double confidence, BlinkStateMachineEvent* outEvent) {
  BlinkStateMachineEvent timeoutEvent;
  pollTimeout(timestampS, &timeoutEvent);  // discarded here, same as pipeline.ts's handling

  if (state_ == State::kRefractory) {
    return false;
  }

  if (state_ == State::kIdle) {
    state_ = State::kWaitForSecond;
    firstBlinkTimeS_ = timestampS;
    firstBlinkConfidence_ = confidence;
    hasFirstBlinkTime_ = true;
    return false;
  }

  if (state_ == State::kWaitForSecond) {
    double interval = timestampS - firstBlinkTimeS_;

    if (interval < minIntervalS_) {
      return false;  // ringing/bounce from the same physical blink
    }

    if (interval <= maxIntervalS_) {
      outEvent->eventType = BlinkEventType::kDoubleBlinkConfirmed;
      outEvent->timestampS = timestampS;
      outEvent->firstBlinkTimestampS = firstBlinkTimeS_;
      outEvent->secondBlinkTimestampS = timestampS;
      outEvent->hasSecondBlinkTimestamp = true;
      outEvent->interBlinkIntervalS = interval;
      outEvent->hasInterBlinkInterval = true;
      outEvent->confidence = std::min(firstBlinkConfidence_, confidence);

      state_ = State::kRefractory;
      refractoryUntilS_ = timestampS + refractoryAfterDoubleS_;
      hasRefractoryUntil_ = true;
      hasFirstBlinkTime_ = false;
      return true;
    }

    // Too slow to be a double blink: start a fresh sequence with this blink.
    firstBlinkTimeS_ = timestampS;
    firstBlinkConfidence_ = confidence;
    return false;
  }

  return false;
}

void BlinkStateMachine::toIdle() {
  state_ = State::kIdle;
  hasFirstBlinkTime_ = false;
  firstBlinkConfidence_ = 0.0;
}

void BlinkStateMachine::reset() {
  toIdle();
  hasRefractoryUntil_ = false;
}

}  // namespace bcihand
