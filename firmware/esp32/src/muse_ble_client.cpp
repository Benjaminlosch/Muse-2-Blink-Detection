#include "muse_ble_client.h"

#include "config.h"

// Only needed for OPERATING_MODE_STANDALONE (Mode B) — compiled out of
// Mode A builds so they don't pay for the NimBLE-Arduino stack they never
// use (~19KB flash observed).
#if defined(OPERATING_MODE_STANDALONE)

#include <Arduino.h>
#include <NimBLEDevice.h>

#include "../lib/core/muse_protocol.h"

namespace bcihand {

MuseBleClient* MuseBleClient::instance_ = nullptr;

namespace {
constexpr uint32_t kScanTimeMs = 0;  // 0 = scan forever until a match is found
constexpr int kSampleQueueLength = 64;

NimBLEUUID serviceUuid() { return NimBLEUUID(muse_protocol::kServiceUuid16); }

class ScanCallbacks : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* device) override {
    if (device->isAdvertisingService(serviceUuid())) {
      NimBLEDevice::getScan()->stop();
      if (MuseBleClient::instance()) {
        MuseBleClient::instance()->handleAdvertisedDevice(const_cast<NimBLEAdvertisedDevice*>(device));
      }
    }
  }
};

class ClientCallbacks : public NimBLEClientCallbacks {
  void onConnect(NimBLEClient* /*pClient*/) override {
    if (MuseBleClient::instance()) MuseBleClient::instance()->handleConnected();
  }
  void onDisconnect(NimBLEClient* /*pClient*/, int /*reason*/) override {
    if (MuseBleClient::instance()) MuseBleClient::instance()->handleDisconnected();
  }
};

ScanCallbacks g_scanCallbacks;
ClientCallbacks g_clientCallbacks;

void eegNotifyCallback0(NimBLERemoteCharacteristic*, uint8_t* data, size_t length, bool) {
  if (MuseBleClient::instance()) MuseBleClient::instance()->handleEegNotification(0, data, static_cast<int>(length));
}
void eegNotifyCallback1(NimBLERemoteCharacteristic*, uint8_t* data, size_t length, bool) {
  if (MuseBleClient::instance()) MuseBleClient::instance()->handleEegNotification(1, data, static_cast<int>(length));
}
void eegNotifyCallback2(NimBLERemoteCharacteristic*, uint8_t* data, size_t length, bool) {
  if (MuseBleClient::instance()) MuseBleClient::instance()->handleEegNotification(2, data, static_cast<int>(length));
}
void eegNotifyCallback3(NimBLERemoteCharacteristic*, uint8_t* data, size_t length, bool) {
  if (MuseBleClient::instance()) MuseBleClient::instance()->handleEegNotification(3, data, static_cast<int>(length));
}
void (*eegNotifyCallbacks[4])(NimBLERemoteCharacteristic*, uint8_t*, size_t, bool) = {
    eegNotifyCallback0, eegNotifyCallback1, eegNotifyCallback2, eegNotifyCallback3};

void accelNotifyCallback(NimBLERemoteCharacteristic*, uint8_t* data, size_t length, bool) {
  if (MuseBleClient::instance()) MuseBleClient::instance()->handleAccelNotification(data, static_cast<int>(length));
}

void telemetryNotifyCallback(NimBLERemoteCharacteristic*, uint8_t* data, size_t length, bool) {
  if (MuseBleClient::instance()) MuseBleClient::instance()->handleTelemetryNotification(data, static_cast<int>(length));
}
}  // namespace

MuseBleClient::MuseBleClient() { instance_ = this; }

void MuseBleClient::begin() {
  sampleQueue_ = xQueueCreate(kSampleQueueLength, sizeof(MuseSample));

  NimBLEDevice::init("BciHandStandalone");
  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setScanCallbacks(&g_scanCallbacks, false);
  scan->setInterval(100);
  scan->setWindow(100);
  scan->setActiveScan(true);

  state_ = MuseConnectionState::kScanning;
  scan->start(kScanTimeMs);
}

void MuseBleClient::handleAdvertisedDevice(void* advertisedDevicePtr) {
  state_ = MuseConnectionState::kConnecting;
  connectToDevice(advertisedDevicePtr);
}

void MuseBleClient::connectToDevice(void* advertisedDevicePtr) {
  auto* advDevice = static_cast<const NimBLEAdvertisedDevice*>(advertisedDevicePtr);

  NimBLEClient* client = NimBLEDevice::createClient();
  client->setClientCallbacks(&g_clientCallbacks, false);
  client->setConnectTimeout(10 * 1000);

  if (!client->connect(advDevice)) {
    NimBLEDevice::deleteClient(client);
    state_ = MuseConnectionState::kDisconnected;
    NimBLEDevice::getScan()->start(kScanTimeMs);
    return;
  }

  NimBLERemoteService* service = client->getService(serviceUuid());
  if (!service) {
    client->disconnect();
    return;
  }

  NimBLERemoteCharacteristic* controlChar = service->getCharacteristic(muse_protocol::kControlCharacteristicUuid);
  NimBLERemoteCharacteristic* telemetryChar = service->getCharacteristic(muse_protocol::kTelemetryCharacteristicUuid);
  NimBLERemoteCharacteristic* accelChar = service->getCharacteristic(muse_protocol::kAccelerometerCharacteristicUuid);

  if (telemetryChar && telemetryChar->canNotify()) telemetryChar->subscribe(true, telemetryNotifyCallback);
  if (accelChar && accelChar->canNotify()) accelChar->subscribe(true, accelNotifyCallback);

  for (int electrode = 0; electrode < 4; electrode++) {
    NimBLERemoteCharacteristic* eegChar = service->getCharacteristic(muse_protocol::kEegCharacteristicUuids[electrode]);
    if (eegChar && eegChar->canNotify()) eegChar->subscribe(true, eegNotifyCallbacks[electrode]);
  }

  // Start streaming: pause, select the EEG-only preset ("p21" — see
  // muse_protocol.h / docs/WEB_BLUETOOTH.md for why not "p50"), resume.
  if (controlChar && controlChar->canWrite()) {
    uint8_t cmdBuf[8];
    int len;
    len = muse_protocol::encodeControlCommand("h", cmdBuf, sizeof(cmdBuf));
    controlChar->writeValue(cmdBuf, len);
    delay(50);
    len = muse_protocol::encodeControlCommand("p21", cmdBuf, sizeof(cmdBuf));
    controlChar->writeValue(cmdBuf, len);
    delay(50);
    len = muse_protocol::encodeControlCommand("s", cmdBuf, sizeof(cmdBuf));
    controlChar->writeValue(cmdBuf, len);
    delay(50);
    len = muse_protocol::encodeControlCommand("d", cmdBuf, sizeof(cmdBuf));
    controlChar->writeValue(cmdBuf, len);
  }
}

void MuseBleClient::handleConnected() { state_ = MuseConnectionState::kConnected; }

void MuseBleClient::handleDisconnected() {
  state_ = MuseConnectionState::kDisconnected;
  hasLastIndex_ = false;
  hasLastAccel_ = false;
  zipper_.reset();
  NimBLEDevice::getScan()->start(kScanTimeMs);
  state_ = MuseConnectionState::kScanning;
}

double MuseBleClient::getTimestamp(int eventIndex, int samplesPerReading, double frequencyHz) {
  double readingDeltaMs = 1000.0 * (1.0 / frequencyHz) * samplesPerReading;
  if (!hasLastIndex_) {
    lastIndex_ = eventIndex;
    lastTimestampMs_ = millis() - readingDeltaMs;
    hasLastIndex_ = true;
  }

  long idx = eventIndex;
  while (lastIndex_ - idx > 0x1000) idx += 0x10000;

  if (idx == lastIndex_) {
    return lastTimestampMs_;
  }
  if (idx > lastIndex_) {
    lastTimestampMs_ += readingDeltaMs * (idx - lastIndex_);
    lastIndex_ = idx;
    return lastTimestampMs_;
  }
  return lastTimestampMs_ - readingDeltaMs * (lastIndex_ - idx);
}

void MuseBleClient::handleEegNotification(int electrodeIndex, const uint8_t* data, int length) {
  if (length < 3) return;
  int eventIndex = (data[0] << 8) | data[1];

  int raw[muse_protocol::kEegSamplesPerNotification];
  int n = muse_protocol::decodeUnsigned12BitSamples(data + 2, length - 2, raw, muse_protocol::kEegSamplesPerNotification);
  double uv[muse_protocol::kEegSamplesPerNotification];
  muse_protocol::scaleEegSamplesUv(raw, uv, n);

  double groupTimestampMs = getTimestamp(eventIndex, n, muse_protocol::kEegSampleRateHz);

  zipper_.push(electrodeIndex, groupTimestampMs, uv, n, [this](const ZippedEegSample& s) { emitSample(s); });
}

void MuseBleClient::emitSample(const ZippedEegSample& zipped) {
  MuseSample sample;
  sample.timestampS = zipped.timestampMs / 1000.0;
  sample.tp9 = zipped.tp9;
  sample.af7 = zipped.af7;
  sample.af8 = zipped.af8;
  sample.tp10 = zipped.tp10;
  sample.hasAccel = hasLastAccel_;
  sample.accelX = lastAccelX_;
  sample.accelY = lastAccelY_;
  sample.accelZ = lastAccelZ_;

  if (sampleQueue_) {
    xQueueSend(sampleQueue_, &sample, 0);  // non-blocking; drop on overflow rather than stall the BLE task
  }
}

void MuseBleClient::handleAccelNotification(const uint8_t* data, int length) {
  muse_protocol::ImuTriplet samples[3];
  muse_protocol::decodeAccelerometerSamples(data, length, samples);
  lastAccelX_ = samples[2].x;
  lastAccelY_ = samples[2].y;
  lastAccelZ_ = samples[2].z;
  hasLastAccel_ = true;
}

void MuseBleClient::handleTelemetryNotification(const uint8_t* data, int length) {
  if (length < 4) return;
  uint16_t raw = (data[2] << 8) | data[3];
  batteryPercent_ = raw / 512.0;
}

int MuseBleClient::poll(MuseSample* outSamples, int outCapacity) {
  if (!sampleQueue_) return 0;
  int count = 0;
  while (count < outCapacity && xQueueReceive(sampleQueue_, &outSamples[count], 0) == pdTRUE) {
    count++;
  }
  return count;
}

}  // namespace bcihand

#endif  // OPERATING_MODE_STANDALONE
