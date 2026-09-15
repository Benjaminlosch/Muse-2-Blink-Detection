// Boot-time DSP self-test and a status LED, per docs/SAFETY.md's testing
// order (Simulator -> PC console -> ESP32 serial output -> LED output ->
// motor driver disconnected -> ...). Both run before the motor is ever
// touched.
#pragma once

#include "safety_state_machine.h"

namespace bcihand {
namespace diagnostics {

// Runs lib/core/dsp.h's CausalBlinkBandFilter against the golden vector in
// lib/core/dsp_golden_vector.h and prints "DSP_SELF_TEST:PASS" or
// "DSP_SELF_TEST:FAIL max_abs_diff_uv=<value>" over Serial. This is the
// project brief section 20 Python-vs-embedded-DSP numeric comparison,
// executed on the real target at boot rather than offline, since no host
// compiler was available to run it as a native unit test in the
// environment this was written in (see docs/TESTING.md).
void runDspSelfTest();

void beginStatusLed();

// Solid off = HOLD, fast blink = OPEN, slow blink = CLOSE. An arbitrary but
// documented convention for the bench-test "LED output" stage —
// WAITING FOR HARDWARE VERIFICATION that config::pins::kStatusLedPin is
// actually wired to a visible LED on the target board.
void updateStatusLed(unsigned long now_ms, Command effective_command);

}  // namespace diagnostics
}  // namespace bcihand
