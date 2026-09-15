// Mode B standalone ESP32 firmware (project brief: "train it up... then
// upload it to GitHub... connect the Muse 2 to the ESP32 through
// Bluetooth... strictly on the ESP32"):
//   Muse 2 --BLE--> [this firmware: full pipeline] --> motor
//
// No PC, browser, or serial link is needed at runtime. Calibrate on the
// web app first, export the tuned config from the Calibration page, drop
// the generated pipeline_config.h into lib/core/, then build this firmware
// with `-D OPERATING_MODE_STANDALONE=1` (see docs/ESP32_SETUP.md "Mode B").
//
// WAITING FOR HARDWARE VERIFICATION: verified to compile and link against
// the real ESP32 toolchain and NimBLE-Arduino, but never exercised against
// a physical Muse 2 or ESP32 in the environment this was built in. Follow
// docs/SAFETY.md's bench-test order before connecting a real prosthetic
// hand — this file's own safety behavior (HOLD on Muse disconnect, HOLD on
// poor signal, HOLD on uncertain classification) has only been checked by
// careful code review and the fact that it reuses the same gating logic
// already exercised by tests/test_end_to_end_simulation.py and
// web/src/core/pipeline.test.ts, not by an equivalent embedded test (see
// docs/TESTING.md "Known gap").
#include <Arduino.h>

#include "config.h"

#if defined(OPERATING_MODE_STANDALONE)

#include "../lib/core/blink_pipeline.h"
#include "../lib/core/pipeline_config.h"
#include "diagnostics.h"
#include "motor.h"
#include "muse_ble_client.h"

using bcihand::BlinkPipeline;
using bcihand::Command;
using bcihand::Motor;
using bcihand::MuseBleClient;
using bcihand::MuseConnectionState;
using bcihand::MuseSample;
using bcihand::Sample;

namespace {

Motor g_motor;
MuseBleClient g_museClient;
BlinkPipeline g_pipeline(bcihand::activePipelineConfig());

constexpr int kMaxSamplesPerPoll = 64;  // generous headroom over the ~24 samples/12ms burst rate at 256Hz/12-per-notify
unsigned long g_lastStateLogMs = 0;
constexpr unsigned long kStateLogIntervalMs = 1000;

const char* commandName(Command c) {
  switch (c) {
    case Command::kOpen:
      return "OPEN";
    case Command::kClose:
      return "CLOSE";
    case Command::kHold:
    default:
      return "HOLD";
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(50);

  bcihand::diagnostics::runDspSelfTest();

  g_motor.begin();  // never drives on boot — HOLD is inert
  bcihand::diagnostics::beginStatusLed();

  Serial.println("STATE:HOLD");  // startup state is always HOLD, matching Mode A's contract
  Serial.println("Standalone mode: scanning for Muse 2...");

  g_museClient.begin();
}

void loop() {
  unsigned long now = millis();

  // Muse disconnected (or never connected): force HOLD directly, bypassing
  // the pipeline entirely — "no fresh data" must never mean "keep applying
  // the last computed command forever." Matches Mode A's comm-timeout ->
  // HOLD behavior, and docs/SAFETY.md's "Muse 2 disconnects mid-session"
  // web-app rule, applied here on-device instead.
  if (g_museClient.state() != MuseConnectionState::kConnected) {
    g_motor.applyCommand(Command::kHold);
    bcihand::diagnostics::updateStatusLed(now, Command::kHold);
    if (now - g_lastStateLogMs >= kStateLogIntervalMs) {
      Serial.print("STATE:HOLD (muse not connected, state=");
      Serial.print(static_cast<int>(g_museClient.state()));
      Serial.println(")");
      g_lastStateLogMs = now;
    }
    return;
  }

  MuseSample museSamples[kMaxSamplesPerPoll];
  int n = g_museClient.poll(museSamples, kMaxSamplesPerPoll);

  Command effective = Command::kHold;
  bool hadSample = false;

  for (int i = 0; i < n; i++) {
    Sample sample;
    sample.timestampS = museSamples[i].timestampS;
    sample.af7 = museSamples[i].af7;
    sample.af8 = museSamples[i].af8;
    sample.tp9 = museSamples[i].tp9;
    sample.tp10 = museSamples[i].tp10;
    sample.hasAccel = museSamples[i].hasAccel;
    sample.accelX = museSamples[i].accelX;
    sample.accelY = museSamples[i].accelY;
    sample.accelZ = museSamples[i].accelZ;

    auto result = g_pipeline.processSample(sample);
    effective = result.gateDecision.command;
    hadSample = true;

    if (result.hasStateEvent) {
      Serial.print("EVENT conf=");
      Serial.print(result.stateEvent.confidence, 2);
      Serial.print(" -> ");
      Serial.println(commandName(effective));
    }
  }

  if (hadSample) {
    g_motor.applyCommand(effective);
    bcihand::diagnostics::updateStatusLed(now, effective);
  }

  if (now - g_lastStateLogMs >= kStateLogIntervalMs) {
    Serial.print("STATE:");
    Serial.print(commandName(effective));
    Serial.print(" battery=");
    Serial.println(g_museClient.batteryPercent(), 1);
    g_lastStateLogMs = now;
  }
}

#endif  // OPERATING_MODE_STANDALONE
