// ESP32-as-BLE-central connection to a real Muse 2 (Mode B / "standalone"
// operation — project brief: no PC/browser in the loop at runtime). Uses
// NimBLE-Arduino (h2zero/NimBLE-Arduino, actively maintained, verified
// before adding as a dependency — see docs/ESP32_SETUP.md "Mode B") and
// the protocol constants verified in lib/core/muse_protocol.h.
//
// WAITING FOR HARDWARE VERIFICATION: written against NimBLE-Arduino's
// documented client API (confirmed via its own official example, not
// guessed) but never exercised against a physical Muse 2 or run on real
// ESP32 hardware in the environment this was built in.
#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

#include "../lib/core/eeg_zipper.h"

namespace bcihand {

enum class MuseConnectionState { kDisconnected, kScanning, kConnecting, kConnected };

struct MuseSample {
  double timestampS;
  double tp9, af7, af8, tp10;
  bool hasAccel;
  double accelX, accelY, accelZ;
};

class MuseBleClient {
 public:
  MuseBleClient();

  // Call once from setup(). Initializes the BLE stack and starts scanning
  // for a device advertising the Muse service UUID.
  void begin();

  // Call every loop() iteration. Drains any samples received since the
  // last call (from the BLE notification callbacks, which run on NimBLE's
  // own FreeRTOS task) into outSamples. Returns how many were written.
  int poll(MuseSample* outSamples, int outCapacity);

  MuseConnectionState state() const { return state_; }
  double batteryPercent() const { return batteryPercent_; }

  // Called internally by the NimBLE callback trampolines (public so the
  // free-function callbacks in the .cpp can reach it via the singleton).
  void handleEegNotification(int electrodeIndex, const uint8_t* data, int length);
  void handleAccelNotification(const uint8_t* data, int length);
  void handleTelemetryNotification(const uint8_t* data, int length);
  void handleConnected();
  void handleDisconnected();
  void handleAdvertisedDevice(void* advertisedDevice);  // void* to avoid leaking NimBLE types into this header

  static MuseBleClient* instance() { return instance_; }

 private:
  static MuseBleClient* instance_;

  MuseConnectionState state_ = MuseConnectionState::kDisconnected;
  double batteryPercent_ = -1.0;

  EegZipper zipper_;
  QueueHandle_t sampleQueue_ = nullptr;

  bool hasLastAccel_ = false;
  double lastAccelX_ = 0, lastAccelY_ = 0, lastAccelZ_ = 0;

  // Muse's own internal packet-index clock, shared across all 4 EEG
  // characteristics — ported from museClient.ts's getTimestamp(), which
  // itself ports muse-js's MuseClient.getTimestamp() (see
  // docs/WEB_BLUETOOTH.md for source verification).
  bool hasLastIndex_ = false;
  long lastIndex_ = 0;
  double lastTimestampMs_ = 0;
  double getTimestamp(int eventIndex, int samplesPerReading, double frequencyHz);

  void emitSample(const ZippedEegSample& zipped);
  void connectToDevice(void* advertisedDevice);
};

}  // namespace bcihand
