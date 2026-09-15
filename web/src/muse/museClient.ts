/**
 * Web Bluetooth connection to a real Muse 2 headband. Runs on the main
 * thread (Web Bluetooth is not available in Worker contexts in current
 * browsers) and forwards decoded samples to the pipeline worker — see
 * worker/pipelineWorker.ts and docs/WEB_BLUETOOTH.md.
 *
 * WAITING FOR HARDWARE VERIFICATION: written against the protocol verified
 * in protocol.ts (two independent real open-source implementations), but
 * never exercised against a physical Muse 2 in the environment this was
 * built in.
 */
import { EegZipper, type ZippedEegSample } from "./eegZipper";
import {
  ACCELEROMETER_CHARACTERISTIC_UUID,
  ACCELEROMETER_SCALE_G,
  CONTROL_CHARACTERISTIC_UUID,
  EEG_CHARACTERISTIC_UUIDS,
  GYROSCOPE_CHARACTERISTIC_UUID,
  GYROSCOPE_SCALE_DPS,
  MUSE_SERVICE_UUID,
  STREAM_START_COMMANDS,
  STREAM_STOP_COMMAND,
  TELEMETRY_CHARACTERISTIC_UUID,
  decodeEegSamplesUv,
  decodeImuSamples,
  decodeTelemetry,
} from "./protocol";

export interface BrowserCompatibility {
  isSecureContext: boolean;
  bluetoothAvailable: boolean;
  serialAvailable: boolean;
}

export function checkBrowserCompatibility(): BrowserCompatibility {
  return {
    isSecureContext: typeof window !== "undefined" && window.isSecureContext,
    bluetoothAvailable: typeof navigator !== "undefined" && "bluetooth" in navigator,
    serialAvailable: typeof navigator !== "undefined" && "serial" in navigator,
  };
}

export type MuseConnectionState = "disconnected" | "connecting" | "connected";

export interface MuseClientCallbacks {
  onSample?: (sample: ZippedEegSample & { accelX: number | null; accelY: number | null; accelZ: number | null }) => void;
  onConnectionStateChange?: (state: MuseConnectionState, deviceName: string | null) => void;
  onBattery?: (percent: number) => void;
  onError?: (error: Error) => void;
}

export class MuseClient {
  private device: BluetoothDevice | null = null;
  private gatt: BluetoothRemoteGATTServer | null = null;
  private controlChar: BluetoothRemoteGATTCharacteristic | null = null;
  private readonly eegZipper = new EegZipper();
  // Muse's own internal packet-index clock, shared across all EEG
  // characteristics (see protocol.ts / docs/WEB_BLUETOOTH.md) — matches
  // muse-js's getTimestamp() bookkeeping exactly, since two notifications
  // reporting the same underlying event index must resolve to the same
  // group timestamp for the EegZipper to correlate them correctly.
  private lastIndex: number | null = null;
  private lastTimestampMs: number | null = null;

  private lastAccelG: { x: number; y: number; z: number } | null = null;

  private state: MuseConnectionState = "disconnected";
  private readonly callbacks: MuseClientCallbacks;

  constructor(callbacks: MuseClientCallbacks = {}) {
    this.callbacks = callbacks;
  }

  get connectionState(): MuseConnectionState {
    return this.state;
  }

  get deviceName(): string | null {
    return this.device?.name ?? null;
  }

  async connect(): Promise<void> {
    const compat = checkBrowserCompatibility();
    if (!compat.isSecureContext || !compat.bluetoothAvailable) {
      throw new Error("Web Bluetooth is not available. Open this app in Chrome or Edge over HTTPS (or localhost).");
    }

    this.setState("connecting");
    try {
      this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [MUSE_SERVICE_UUID] }] });
      this.device.addEventListener("gattserverdisconnected", () => this.handleDisconnect());

      this.gatt = await this.device.gatt!.connect();
      const service = await this.gatt.getPrimaryService(MUSE_SERVICE_UUID);

      this.controlChar = await service.getCharacteristic(CONTROL_CHARACTERISTIC_UUID);
      await this.subscribe(this.controlChar, () => {
        /* control/device-info responses are not currently surfaced in the UI */
      });

      const telemetryChar = await service.getCharacteristic(TELEMETRY_CHARACTERISTIC_UUID);
      await this.subscribe(telemetryChar, (view) => {
        const telemetry = decodeTelemetry(view);
        this.callbacks.onBattery?.(telemetry.batteryPercent);
      });

      const accelChar = await service.getCharacteristic(ACCELEROMETER_CHARACTERISTIC_UUID);
      await this.subscribe(accelChar, (view) => {
        const triplets = decodeImuSamples(view, ACCELEROMETER_SCALE_G);
        this.lastAccelG = triplets[triplets.length - 1];
      });

      // Gyroscope is decoded (available via protocol.ts) but not currently
      // consumed by the pipeline (see detection/motion_veto.py's Python
      // equivalent, which is accelerometer-only) — subscribe so telemetry
      // is available for the Diagnostics page without changing detection behavior.
      const gyroChar = await service.getCharacteristic(GYROSCOPE_CHARACTERISTIC_UUID);
      await this.subscribe(gyroChar, (view) => {
        decodeImuSamples(view, GYROSCOPE_SCALE_DPS);
      });

      for (let electrode = 0; electrode < 4; electrode++) {
        const char = await service.getCharacteristic(EEG_CHARACTERISTIC_UUIDS[electrode]);
        await this.subscribe(char, (view) => this.handleEegNotification(electrode, view));
      }

      for (const cmd of STREAM_START_COMMANDS) {
        await this.controlChar.writeValue(cmd);
      }

      this.setState("connected");
    } catch (error) {
      this.setState("disconnected");
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.controlChar) await this.controlChar.writeValue(STREAM_STOP_COMMAND);
    } catch {
      // best-effort; the device may already be gone
    }
    this.gatt?.disconnect();
    this.handleDisconnect();
  }

  private handleDisconnect(): void {
    this.lastIndex = null;
    this.lastTimestampMs = null;
    this.lastAccelG = null;
    this.gatt = null;
    this.eegZipper.reset();
    this.setState("disconnected");
  }

  private setState(state: MuseConnectionState): void {
    this.state = state;
    this.callbacks.onConnectionStateChange?.(state, this.deviceName);
  }

  private async subscribe(char: BluetoothRemoteGATTCharacteristic, onValue: (view: DataView) => void): Promise<void> {
    await char.startNotifications();
    char.addEventListener("characteristicvaluechanged", () => {
      if (char.value) onValue(char.value);
    });
  }

  private handleEegNotification(electrode: number, view: DataView): void {
    const eventIndex = view.getUint16(0, false);
    const bytes = new Uint8Array(view.buffer, view.byteOffset + 2);
    const samples = decodeEegSamplesUv(bytes);
    const groupTimestampMs = this.getTimestamp(eventIndex, samples.length, 256);

    this.eegZipper.push(electrode, groupTimestampMs, samples, (zipped) => this.emitSample(zipped));
  }

  private emitSample(zipped: ZippedEegSample): void {
    this.callbacks.onSample?.({
      ...zipped,
      accelX: this.lastAccelG?.x ?? null,
      accelY: this.lastAccelG?.y ?? null,
      accelZ: this.lastAccelG?.z ?? null,
    });
  }

  /** Ported from muse-js's MuseClient.getTimestamp() — see protocol.ts's
   * module docstring for source verification. Converts the device's
   * wrapping 16-bit packet-index counter into a monotonic wall-clock-ish
   * timestamp (ms), handling index wraparound. */
  private getTimestamp(eventIndex: number, samplesPerReading: number, frequencyHz: number): number {
    const readingDeltaMs = 1000 * (1.0 / frequencyHz) * samplesPerReading;
    if (this.lastIndex === null || this.lastTimestampMs === null) {
      this.lastIndex = eventIndex;
      this.lastTimestampMs = Date.now() - readingDeltaMs;
    }

    while (this.lastIndex - eventIndex > 0x1000) {
      eventIndex += 0x10000;
    }

    if (eventIndex === this.lastIndex) {
      return this.lastTimestampMs;
    }
    if (eventIndex > this.lastIndex) {
      this.lastTimestampMs += readingDeltaMs * (eventIndex - this.lastIndex);
      this.lastIndex = eventIndex;
      return this.lastTimestampMs;
    }
    return this.lastTimestampMs - readingDeltaMs * (this.lastIndex - eventIndex);
  }
}
