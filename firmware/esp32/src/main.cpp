// Mode A ESP32 safety receiver (project brief sections 12/13/25):
//   Muse 2 -> PC -> BlinkPipeline -> serial command -> [this firmware] -> motor
//
// This firmware trusts nothing from the PC beyond the literal protocol
// frames in include/protocol.h. HOLD is the fail-safe default: on boot, on
// communication loss, and on any unparseable frame — see
// lib/core/safety_state_machine.h and docs/SAFETY.md.
//
// WAITING FOR HARDWARE VERIFICATION: this has been verified to compile
// against the real ESP32 toolchain (PlatformIO + esp32dev board +
// arduino-esp32 framework) but has not been flashed to or run on physical
// hardware. Follow docs/SAFETY.md's bench-test order before connecting a
// real prosthetic hand.
#include <Arduino.h>

#include "comms.h"
#include "config.h"
#include "diagnostics.h"
#include "motor.h"
#include "protocol.h"
#include "safety_state_machine.h"

using bcihand::Command;
using bcihand::Comms;
using bcihand::FrameKind;
using bcihand::Motor;
using bcihand::ParsedFrame;
using bcihand::SafetyStateMachine;

namespace {

SafetyStateMachine g_safety(bcihand::timing::kCommTimeoutMs);
Motor g_motor;
Comms g_comms;
unsigned long g_last_state_broadcast_ms = 0;

const char* commandName(Command c) {
  switch (c) {
    case Command::kOpen:
      return bcihand::protocol::kCommandOpen;
    case Command::kClose:
      return bcihand::protocol::kCommandClose;
    case Command::kHold:
    default:
      return bcihand::protocol::kCommandHold;
  }
}

}  // namespace

void setup() {
  g_comms.begin(bcihand::timing::kSerialBaudRate);
  delay(50);  // let the serial monitor attach before the self-test output

  bcihand::diagnostics::runDspSelfTest();

  g_motor.begin();  // never drives on boot — HOLD is inert (see motor.cpp)
  bcihand::diagnostics::beginStatusLed();

  Serial.print(bcihand::protocol::kStatePrefix);
  Serial.println(bcihand::protocol::kCommandHold);  // startup state is always HOLD
}

void loop() {
  unsigned long now = millis();

  ParsedFrame frame;
  while (g_comms.poll(&frame)) {
    switch (frame.kind) {
      case FrameKind::kCommand:
        g_safety.onCommandReceived(frame.command, now);
        g_comms.sendAck(commandName(frame.command));
        break;
      case FrameKind::kHeartbeat:
        g_safety.onFrameReceived(now);
        g_comms.sendHeartbeatAck();
        break;
      case FrameKind::kInvalid:
      default:
        g_safety.onInvalidFrameReceived(now);
        break;
    }
  }

  Command effective = g_safety.update(now);
  g_motor.applyCommand(effective);
  bcihand::diagnostics::updateStatusLed(now, effective);

  if (now - g_last_state_broadcast_ms >= bcihand::timing::kStateBroadcastIntervalMs) {
    g_comms.sendState(commandName(effective));
    g_last_state_broadcast_ms = now;
  }
}
