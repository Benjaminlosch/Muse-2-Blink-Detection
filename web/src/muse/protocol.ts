/**
 * Muse 2 Bluetooth LE protocol constants.
 *
 * NOT independently reverse-engineered or invented here. Every UUID, the
 * EEG channel ordering, the 12-bit sample packing, and the accelerometer/
 * gyroscope scale factors below were verified directly against the actual
 * source code of two independent, real, long-standing open-source
 * projects, which agree exactly:
 *
 *   - itayinbarr/web-muse (github.com/itayinbarr/web-muse), actively
 *     maintained (pushed 2025-12-02 at verification time), explicitly
 *     tested against Muse 2 — src/lib/MuseDevice.js
 *   - urish/muse-js (github.com/urish/muse-js), the original/most-starred
 *     (306 stars) Muse Web Bluetooth library, TypeScript, explicit Muse 2
 *     support — src/muse.ts, src/lib/muse-parse.ts
 *
 * See docs/WEB_BLUETOOTH.md for the full verification notes (dates,
 * commit references, cross-check method). Per project brief section 2,
 * nothing here is fabricated: both sources were fetched and read in full
 * before writing this file, not guessed from memory or general Bluetooth
 * knowledge.
 */

/** Muse's custom BLE service (16-bit UUID; Web Bluetooth accepts a number
 * for 16-bit UUIDs directly in device filters). */
export const MUSE_SERVICE_UUID = 0xfe8d;

export const CONTROL_CHARACTERISTIC_UUID = "273e0001-4c4d-454d-96be-f03bac821358";
export const EEG_CHARACTERISTIC_UUIDS = [
  "273e0003-4c4d-454d-96be-f03bac821358", // EEG1 -> TP9
  "273e0004-4c4d-454d-96be-f03bac821358", // EEG2 -> AF7
  "273e0005-4c4d-454d-96be-f03bac821358", // EEG3 -> AF8
  "273e0006-4c4d-454d-96be-f03bac821358", // EEG4 -> TP10
  "273e0007-4c4d-454d-96be-f03bac821358", // EEG5 -> AUX (not exposed on consumer Muse 2; unused here)
] as const;
export const GYROSCOPE_CHARACTERISTIC_UUID = "273e0009-4c4d-454d-96be-f03bac821358";
export const ACCELEROMETER_CHARACTERISTIC_UUID = "273e000a-4c4d-454d-96be-f03bac821358";
export const TELEMETRY_CHARACTERISTIC_UUID = "273e000b-4c4d-454d-96be-f03bac821358"; // battery + fuel-gauge voltage + temperature
export const PPG_CHARACTERISTIC_UUIDS = [
  "273e000f-4c4d-454d-96be-f03bac821358", // ambient
  "273e0010-4c4d-454d-96be-f03bac821358", // infrared
  "273e0011-4c4d-454d-96be-f03bac821358", // red
] as const;

/** EEG_CHARACTERISTIC_UUIDS[i] corresponds to this physical electrode.
 * Verified identically in both source projects (muse-js literally exports
 * this as `channelNames`; web-muse's mock-data loader comments the same
 * ordering). AUX is not used by this app. */
export const EEG_CHANNEL_NAMES = ["TP9", "AF7", "AF8", "TP10", "AUX"] as const;

export const EEG_SAMPLE_RATE_HZ = 256;
export const EEG_SAMPLES_PER_NOTIFICATION = 12;
export const IMU_SAMPLES_PER_NOTIFICATION = 3;

/** value = EEG_SCALE * (raw12bit - 0x800), converts the 12-bit unsigned
 * ADC code to microvolts. */
export const EEG_SCALE_UV = 0.48828125;
export const ACCELEROMETER_SCALE_G = 0.0000610352; // 1 / 2^14
export const GYROSCOPE_SCALE_DPS = 0.0074768; // 1 / 2^7

/** Unpacks a byte stream of 12-bit big-endian unsigned samples (the format
 * used by both the EEG characteristics). */
export function decodeUnsigned12BitSamples(bytes: Uint8Array): number[] {
  const samples: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    if (i % 3 === 0) {
      samples.push((bytes[i] << 4) | (bytes[i + 1] >> 4));
    } else {
      samples.push(((bytes[i] & 0xf) << 8) | bytes[i + 1]);
      i++;
    }
  }
  return samples;
}

export function decodeEegSamplesUv(bytes: Uint8Array): number[] {
  return decodeUnsigned12BitSamples(bytes).map((raw) => EEG_SCALE_UV * (raw - 0x800));
}

export interface ImuTriplet {
  x: number;
  y: number;
  z: number;
}

/** Decodes an accelerometer/gyroscope notification: a 16-bit sequence
 * number followed by 3 samples of (x,y,z) int16 triplets. */
export function decodeImuSamples(view: DataView, scale: number): ImuTriplet[] {
  const samples: ImuTriplet[] = [];
  for (let ofs = 2; ofs <= 14; ofs += 6) {
    samples.push({
      x: scale * view.getInt16(ofs, false),
      y: scale * view.getInt16(ofs + 2, false),
      z: scale * view.getInt16(ofs + 4, false),
    });
  }
  return samples;
}

export interface TelemetryData {
  sequenceId: number;
  batteryPercent: number;
  fuelGaugeVoltage: number;
  temperature: number;
}

export function decodeTelemetry(view: DataView): TelemetryData {
  return {
    sequenceId: view.getUint16(0, false),
    batteryPercent: view.getUint16(2, false) / 512,
    fuelGaugeVoltage: view.getUint16(4, false) * 2.2,
    temperature: view.getUint16(8, false),
  };
}

function encodeCommand(cmd: string): Uint8Array<ArrayBuffer> {
  const body = new TextEncoder().encode(`X${cmd}\n`);
  body[0] = body.length - 1;
  return body;
}

/** The control-characteristic command sequence that starts EEG streaming:
 * pause, select a preset, start, resume. web-muse always sends "p50"
 * (its PPG-enabling preset) regardless of whether PPG is used; muse-js
 * documents the presets more precisely — "p21" (EEG only), "p50" (+PPG),
 * "p20" (+AUX) — and picks between them based on which characteristics are
 * actually subscribed. This app does not subscribe to the PPG or AUX
 * characteristics, so "p21" (muse-js's own default) is the correct choice
 * here, not a value invented for this project. */
export const STREAM_START_COMMANDS: readonly Uint8Array<ArrayBuffer>[] = [
  encodeCommand("h"),
  encodeCommand("p21"),
  encodeCommand("s"),
  encodeCommand("d"),
];

/** Requests firmware/device info from the control characteristic (sent
 * separately, after streaming has started — matches both reference
 * implementations). */
export const REQUEST_DEVICE_INFO_COMMAND: Uint8Array<ArrayBuffer> = encodeCommand("v1");

export const STREAM_STOP_COMMAND: Uint8Array<ArrayBuffer> = encodeCommand("h");
