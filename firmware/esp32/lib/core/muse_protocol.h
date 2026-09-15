// Muse 2 Bluetooth LE protocol constants and decode logic — the ESP32-side
// twin of web/src/muse/protocol.ts. Byte-for-byte the same verified
// values; see that file's module docstring for the full source
// verification (two independent real open-source implementations,
// itayinbarr/web-muse and urish/muse-js, cross-checked exactly). Not
// invented or reverse-engineered here — this is a direct port of an
// already-verified port.
//
// Deliberately dependency-free (no NimBLE includes) so the decode math is
// testable independent of the BLE stack — see muse_ble_client.h/.cpp for
// the actual GATT connection using these constants.
#pragma once

#include <cstdint>

namespace bcihand {
namespace muse_protocol {

// Muse's custom BLE service (16-bit UUID).
constexpr uint16_t kServiceUuid16 = 0xfe8d;

constexpr const char* kControlCharacteristicUuid = "273e0001-4c4d-454d-96be-f03bac821358";
// EEG1..EEG4 -> TP9, AF7, AF8, TP10 (verified channel ordering — see
// web/src/muse/protocol.ts). EEG5 (AUX) is not used by this app.
constexpr const char* kEegCharacteristicUuids[4] = {
    "273e0003-4c4d-454d-96be-f03bac821358",  // TP9
    "273e0004-4c4d-454d-96be-f03bac821358",  // AF7
    "273e0005-4c4d-454d-96be-f03bac821358",  // AF8
    "273e0006-4c4d-454d-96be-f03bac821358",  // TP10
};
constexpr const char* kAccelerometerCharacteristicUuid = "273e000a-4c4d-454d-96be-f03bac821358";
constexpr const char* kTelemetryCharacteristicUuid = "273e000b-4c4d-454d-96be-f03bac821358";

constexpr double kEegScaleUv = 0.48828125;             // value = kEegScaleUv * (raw12bit - 0x800)
constexpr double kAccelerometerScaleG = 0.0000610352;  // 1 / 2^14
constexpr int kEegSamplesPerNotification = 12;
constexpr double kEegSampleRateHz = 256.0;

// Unpacks a byte stream of 12-bit big-endian unsigned samples (the format
// used by all 5 EEG characteristics). `bytes` must have at least
// (outCount * 3 + 1) / 2 bytes; writes up to outCapacity decoded samples
// into `out`, returns how many were written.
int decodeUnsigned12BitSamples(const uint8_t* bytes, int byteLength, int* out, int outCapacity);

// Converts decoded 12-bit codes to microvolts in place.
void scaleEegSamplesUv(int* raw, double* outUv, int n);

struct ImuTriplet {
  double x, y, z;
};

// Decodes an accelerometer notification: a 16-bit sequence number followed
// by 3 samples of (x,y,z) int16 triplets, big-endian. `bytes` must be at
// least 20 bytes (2 header + 3*3*2 data).
void decodeAccelerometerSamples(const uint8_t* bytes, int byteLength, ImuTriplet outSamples[3]);

// Builds the "X<cmd>\n" control command with its length-prefix byte,
// matching both reference implementations exactly. Writes into `out`
// (capacity >= cmd length + 2), returns the encoded length.
int encodeControlCommand(const char* cmd, uint8_t* out, int outCapacity);

}  // namespace muse_protocol
}  // namespace bcihand
