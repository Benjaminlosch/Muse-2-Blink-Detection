/**
 * Web Serial connection to an ESP32 running firmware/esp32/. Mirrors
 * communication/serial_link.py: comm health is tracked purely from elapsed
 * time since the last successfully received frame, so HOLD-on-timeout
 * behavior does not depend on any assumption about the ESP32's own
 * internal state — see docs/SAFETY.md.
 *
 * WAITING FOR HARDWARE VERIFICATION: written against the Web Serial API
 * and the protocol verified in firmware/esp32/include/protocol.h /
 * src/bcihand/communication/protocol.py, but never exercised against
 * physical ESP32 firmware in the environment this was built in.
 */
import type { Command } from "../core/types";
import { decodeLine, encodeCommand, encodeHeartbeat, type DecodedFrame } from "./protocol";

export type Esp32ConnectionState = "disconnected" | "connecting" | "connected";

export interface Esp32ClientCallbacks {
  onConnectionStateChange?: (state: Esp32ConnectionState) => void;
  onFrame?: (frame: DecodedFrame) => void;
  onCommHealthChange?: (healthy: boolean) => void;
  onError?: (error: Error) => void;
}

export class Esp32Client {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array<ArrayBuffer>> | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private readLoopAbort = false;
  private lineBuffer = "";

  private state: Esp32ConnectionState = "disconnected";
  private lastAckTimeMs: number | null = null;
  private lastKnownHealthy = false;
  private readonly callbacks: Esp32ClientCallbacks;

  constructor(callbacks: Esp32ClientCallbacks = {}) {
    this.callbacks = callbacks;
  }

  get connectionState(): Esp32ConnectionState {
    return this.state;
  }

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  async connect(baudRate = 115200): Promise<void> {
    if (!Esp32Client.isSupported()) {
      throw new Error("Web Serial is not available. Open this app in Chrome or Edge.");
    }
    this.setState("connecting");
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate });

      const writable = this.port.writable;
      const readable = this.port.readable;
      if (!writable || !readable) throw new Error("Serial port opened but has no readable/writable stream.");

      this.writer = writable.getWriter();
      // @types/w3c-web-serial types SerialPort.readable as
      // ReadableStream<Uint8Array<ArrayBufferLike>>, which doesn't line up
      // with lib.dom's TextDecoderStream (ReadableWritablePair<string,
      // BufferSource>) under TS's stricter typed-array generics — this is
      // a type-only mismatch between two correct runtime APIs, not a real
      // bug; see docs/WEB_SERIAL.md.
      const byteStream = readable as unknown as ReadableStream<Uint8Array<ArrayBuffer>>;
      this.reader = byteStream.pipeThrough(new TextDecoderStream()).getReader();
      this.readLoopAbort = false;
      void this.readLoop();

      this.setState("connected");
    } catch (error) {
      this.setState("disconnected");
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.readLoopAbort = true;
    try {
      await this.sendCommand("HOLD"); // best-effort: leave the hand safe before dropping the link
    } catch {
      // ignore — port may already be gone
    }
    try {
      await this.reader?.cancel();
      this.reader?.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      this.writer?.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      await this.port?.close();
    } catch {
      /* ignore */
    }
    this.port = null;
    this.writer = null;
    this.reader = null;
    this.setCommHealthy(false);
    this.setState("disconnected");
  }

  async sendCommand(command: Command): Promise<void> {
    if (!this.writer) throw new Error("Not connected to an ESP32.");
    await this.writer.write(encodeCommand(command));
  }

  async sendHeartbeat(): Promise<void> {
    if (!this.writer) throw new Error("Not connected to an ESP32.");
    await this.writer.write(encodeHeartbeat());
  }

  /** True if a recognized frame arrived within `timeoutMs` — mirrors
   * SerialLink.is_healthy() in communication/serial_link.py. Call this (or
   * rely on onCommHealthChange) before ever treating a command as safe to
   * send onward. */
  isHealthy(timeoutMs: number, nowMs: number = Date.now()): boolean {
    if (this.lastAckTimeMs === null) return false;
    return nowMs - this.lastAckTimeMs <= timeoutMs;
  }

  private async readLoop(): Promise<void> {
    if (!this.reader) return;
    try {
      while (!this.readLoopAbort) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.handleChunk(value);
      }
    } catch (error) {
      if (!this.readLoopAbort) {
        this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.setCommHealthy(false);
      if (!this.readLoopAbort) {
        // The port dropped out from under us (unplugged, etc.) rather than
        // a deliberate disconnect() call.
        this.setState("disconnected");
      }
    }
  }

  private handleChunk(chunk: string): void {
    this.lineBuffer += chunk;
    let newlineIdx: number;
    while ((newlineIdx = this.lineBuffer.indexOf("\n")) >= 0) {
      const line = this.lineBuffer.slice(0, newlineIdx);
      this.lineBuffer = this.lineBuffer.slice(newlineIdx + 1);
      const frame = decodeLine(line);
      if (frame) {
        this.lastAckTimeMs = Date.now();
        this.setCommHealthy(true);
        this.callbacks.onFrame?.(frame);
      }
    }
  }

  private setState(state: Esp32ConnectionState): void {
    this.state = state;
    this.callbacks.onConnectionStateChange?.(state);
  }

  private setCommHealthy(healthy: boolean): void {
    if (healthy !== this.lastKnownHealthy) {
      this.lastKnownHealthy = healthy;
      this.callbacks.onCommHealthChange?.(healthy);
    }
  }
}
