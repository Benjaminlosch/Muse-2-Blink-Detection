// The ESP32-side fail-safe state machine (project brief sections 13/25,
// docs/SAFETY.md). This is intentionally independent of, and does not
// trust, the PC's own confidence gating (src/bcihand/classification/
// confidence_gate.py) — the PC could crash, send garbage, or lose the
// link entirely, and the hand must still default to HOLD.
//
// Rules enforced here:
//   - Startup default:        HOLD
//   - No frame ever received: HOLD
//   - No frame within comm timeout: HOLD (even if the last valid command
//     was OPEN/CLOSE — a stale command must not keep driving the motor)
//   - An unparseable/invalid frame: forces HOLD immediately (does not just
//     get ignored and leave a stale OPEN/CLOSE in effect)
//   - A well-formed CMD:HOLD / CMD:OPEN / CMD:CLOSE frame: adopted verbatim
//
// Deliberately dependency-free (no Arduino.h) — takes the current time as
// an explicit parameter (millis() at the call site) so it's host-testable.
#pragma once

namespace bcihand {

enum class Command { kHold, kOpen, kClose };

class SafetyStateMachine {
 public:
  explicit SafetyStateMachine(unsigned long comm_timeout_ms) : comm_timeout_ms_(comm_timeout_ms) {}

  // A well-formed CMD:<OPEN|CLOSE|HOLD> frame arrived: adopt it and mark
  // the link alive.
  void onCommandReceived(Command cmd, unsigned long now_ms) {
    commanded_ = cmd;
    last_frame_time_ms_ = now_ms;
    ever_received_frame_ = true;
  }

  // A recognized-but-non-command frame arrived (currently: HEARTBEAT):
  // marks the link alive without changing the commanded state.
  void onFrameReceived(unsigned long now_ms) {
    last_frame_time_ms_ = now_ms;
    ever_received_frame_ = true;
  }

  // An unparseable frame arrived: treat the link as alive (garbage still
  // means *something* is talking to us, so this is not the same failure as
  // silence) but force the commanded state to HOLD, since we cannot trust
  // the content.
  void onInvalidFrameReceived(unsigned long now_ms) {
    commanded_ = Command::kHold;
    last_frame_time_ms_ = now_ms;
    ever_received_frame_ = true;
  }

  bool isCommTimedOut(unsigned long now_ms) const {
    if (!ever_received_frame_) return true;
    return (now_ms - last_frame_time_ms_) > comm_timeout_ms_;
  }

  // Call every loop() iteration. Returns the command that should actually
  // be applied to the motor right now — this is where comm-timeout -> HOLD
  // is enforced, independent of the last explicitly commanded state.
  Command update(unsigned long now_ms) {
    effective_command_ = isCommTimedOut(now_ms) ? Command::kHold : commanded_;
    return effective_command_;
  }

  Command effectiveCommand() const { return effective_command_; }
  Command lastCommanded() const { return commanded_; }

 private:
  unsigned long comm_timeout_ms_;
  unsigned long last_frame_time_ms_ = 0;
  bool ever_received_frame_ = false;
  Command commanded_ = Command::kHold;          // startup default: HOLD
  Command effective_command_ = Command::kHold;  // startup default: HOLD
};

}  // namespace bcihand
