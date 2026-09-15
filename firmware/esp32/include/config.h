// Firmware-wide configuration: pin assignments, timing, and motor tuning.
//
// Pin numbers marked "historical" come from prior ESP32 hand-control work
// referenced in the project brief and have NOT been re-verified against the
// current physical build in this environment (no hardware available) —
// WAITING FOR HARDWARE VERIFICATION. Confirm actual wiring before flashing
// to a real prosthetic hand; see docs/ESP32_SETUP.md and docs/SAFETY.md's
// bench-test order (LED -> motor driver disconnected -> unloaded motor ->
// unloaded mechanism -> physical hand).
#pragma once

// ===== Operating mode selection =====
// OPERATING_MODE_SERIAL (default, "Mode A"): the ESP32 is a dumb-but-safe
// serial receiver — a PC/browser does all EEG acquisition and blink
// detection, and sends OPEN/CLOSE/HOLD over USB serial. This is the
// original, most-verified path (see docs/TESTING.md).
//
// OPERATING_MODE_STANDALONE ("Mode B"): the ESP32 connects directly to a
// Muse 2 over BLE (src/muse_ble_client.cpp) and runs the entire detection/
// classification pipeline itself (lib/core/blink_pipeline.h) — no PC,
// browser, or serial link needed at runtime. Calibrate on the web app
// first (project brief: "train it up... then upload it to GitHub"), export
// the tuned thresholds from the Calibration page, drop the generated
// pipeline_config.h into lib/core/, then build with
// `-D OPERATING_MODE_STANDALONE=1`. WAITING FOR HARDWARE VERIFICATION —
// see docs/ESP32_SETUP.md "Mode B".
#if !defined(OPERATING_MODE_SERIAL) && !defined(OPERATING_MODE_STANDALONE)
#define OPERATING_MODE_SERIAL 1
#endif
#if defined(OPERATING_MODE_SERIAL) && defined(OPERATING_MODE_STANDALONE)
#error "Define exactly one of OPERATING_MODE_SERIAL or OPERATING_MODE_STANDALONE, not both."
#endif

// ===== Motor interface selection =====
// Exactly one of these should be defined. MOTOR_MODE_DC_HBRIDGE is the
// default: it's the more fully-specified historical configuration (4 pins:
// PWM+DIR drive plus two button/limit-switch inputs) versus the single-pin
// servo alternative. Switch by commenting/uncommenting, or override via
// `build_flags = -D MOTOR_MODE_SERVO=1` in platformio.ini.
#if !defined(MOTOR_MODE_DC_HBRIDGE) && !defined(MOTOR_MODE_SERVO)
#define MOTOR_MODE_DC_HBRIDGE 1
#endif

#if defined(MOTOR_MODE_DC_HBRIDGE) && defined(MOTOR_MODE_SERVO)
#error "Define exactly one of MOTOR_MODE_DC_HBRIDGE or MOTOR_MODE_SERVO, not both."
#endif

namespace bcihand {
namespace pins {

#if defined(MOTOR_MODE_DC_HBRIDGE)
// Historical DC H-bridge configuration.
constexpr int kPwmPin = 25;
constexpr int kDirPin = 26;
constexpr int kCloseButtonPin = 18;  // manual override / limit switch input
constexpr int kOpenButtonPin = 19;   // manual override / limit switch input
#elif defined(MOTOR_MODE_SERVO)
// Historical servo configuration.
constexpr int kServoPin = 23;
#endif

constexpr int kStatusLedPin = 2;  // most esp32dev boards have an onboard LED here; WAITING FOR HARDWARE VERIFICATION

}  // namespace pins

namespace timing {
// Matches config/default_config.yaml communication.timeout_s / baud_rate.
// A frame (command or heartbeat) must arrive at least this often or the
// safety state machine forces HOLD — see lib/core/safety_state_machine.h.
constexpr unsigned long kCommTimeoutMs = 1500;
constexpr unsigned long kSerialBaudRate = 115200;

// How often to emit an unsolicited STATE: line even without being asked —
// useful for a plain serial-monitor bench test (project brief section 25:
// "PC console output -> ESP32 serial output" comes before any motor test).
constexpr unsigned long kStateBroadcastIntervalMs = 1000;
}  // namespace timing

namespace motor {
#if defined(MOTOR_MODE_DC_HBRIDGE)
// DC H-bridge PWM duty cycle while actively opening/closing (8-bit, 0-255).
// WAITING FOR HARDWARE VERIFICATION — start low for the "motor without
// mechanical load" bench-test stage in docs/SAFETY.md and increase only
// after confirming direction and behavior are correct.
constexpr int kDriveDutyCycle = 160;
constexpr int kPwmChannel = 0;
constexpr int kPwmFrequencyHz = 20000;  // above the audible range
constexpr int kPwmResolutionBits = 8;
#elif defined(MOTOR_MODE_SERVO)
// Servo endpoint angles. WAITING FOR HARDWARE VERIFICATION.
constexpr int kServoOpenAngleDeg = 180;
constexpr int kServoCloseAngleDeg = 0;
constexpr int kServoHoldAngleDeg = 90;
constexpr int kServoPwmChannel = 0;
constexpr int kServoPwmFrequencyHz = 50;   // standard hobby-servo pulse rate
constexpr int kServoPwmResolutionBits = 16;
constexpr int kServoMinPulseUs = 500;
constexpr int kServoMaxPulseUs = 2500;
#endif
}  // namespace motor

}  // namespace bcihand
