// Single/double-blink temporal state machine — port of
// classification/state_machine.py / web/src/core/classification/stateMachine.ts.
// Every blink fed in here must already have independently passed the full
// classifier; this module's only job is timing/debounce/refractory logic.
// Named BlinkStateMachine (not StateMachine) to avoid colliding with
// safety_state_machine.h's SafetyStateMachine, which is a distinct concept.
#pragma once

namespace bcihand {

enum class BlinkEventType { kSingleBlinkConfirmed, kDoubleBlinkConfirmed };

struct BlinkStateMachineEvent {
  BlinkEventType eventType;
  double timestampS;
  double firstBlinkTimestampS;
  double secondBlinkTimestampS;  // only meaningful for kDoubleBlinkConfirmed
  bool hasSecondBlinkTimestamp;
  double interBlinkIntervalS;  // only meaningful for kDoubleBlinkConfirmed
  bool hasInterBlinkInterval;
  double confidence;
};

class BlinkStateMachine {
 public:
  BlinkStateMachine(double minIntervalS = 0.08, double maxIntervalS = 0.6,
                      double waitForSecondTimeoutS = 0.7, double refractoryAfterDoubleS = 0.5,
                      bool emitSingleOnTimeout = true);

  // Call periodically (or before processing the next blink) so a
  // WAIT_FOR_SECOND timeout can resolve to a single-blink event even if no
  // further blink ever arrives. Returns true and fills `outEvent` if a
  // timeout-driven event fired.
  bool pollTimeout(double nowS, BlinkStateMachineEvent* outEvent);

  // Feed one already-validated blink event's timestamp/confidence.
  // Returns true and fills `outEvent` if this blink completes one.
  bool processValidBlink(double timestampS, double confidence, BlinkStateMachineEvent* outEvent);

  void reset();

 private:
  enum class State { kIdle, kWaitForSecond, kRefractory };

  double minIntervalS_;
  double maxIntervalS_;
  double waitForSecondTimeoutS_;
  double refractoryAfterDoubleS_;
  bool emitSingleOnTimeout_;

  State state_ = State::kIdle;
  bool hasFirstBlinkTime_ = false;
  double firstBlinkTimeS_ = 0.0;
  double firstBlinkConfidence_ = 0.0;
  bool hasRefractoryUntil_ = false;
  double refractoryUntilS_ = 0.0;

  void toIdle();
};

}  // namespace bcihand
