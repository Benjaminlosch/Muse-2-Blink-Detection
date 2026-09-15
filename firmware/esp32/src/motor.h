// Motor interface abstraction over the two historical hardware
// configurations (DC H-bridge PWM+DIR, or a hobby servo) — selected at
// compile time via MOTOR_MODE_DC_HBRIDGE / MOTOR_MODE_SERVO in config.h.
//
// WAITING FOR HARDWARE VERIFICATION: neither mode has been exercised
// against physical hardware in this environment. Follow docs/SAFETY.md's
// bench-test order (LED -> motor driver disconnected -> unloaded motor ->
// unloaded mechanism -> physical hand) before trusting this with a real
// prosthetic hand.
#pragma once

#include "safety_state_machine.h"

namespace bcihand {

class Motor {
 public:
  void begin();

  // Idempotent: safe to call every loop() iteration with the same command.
  // Never applies OPEN/CLOSE torque implicitly — HOLD is always inert.
  void applyCommand(Command command);

 private:
  Command last_applied_ = Command::kHold;
};

}  // namespace bcihand
