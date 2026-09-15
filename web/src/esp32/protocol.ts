/**
 * PC <-> ESP32 serial protocol — must stay byte-for-byte in sync with
 * src/bcihand/communication/protocol.py and
 * firmware/esp32/include/protocol.h. See those files' docstrings for the
 * full frame reference:
 *
 * Frames browser -> ESP32:  CMD:OPEN\n  CMD:CLOSE\n  CMD:HOLD\n  HEARTBEAT\n
 * Frames ESP32 -> browser:  ACK:<CMD>\n  STATE:<STATE>\n  HB_ACK\n
 */
import type { Command } from "../core/types";

export const CMD_PREFIX = "CMD:";
export const ACK_PREFIX = "ACK:";
export const STATE_PREFIX = "STATE:";
export const HEARTBEAT = "HEARTBEAT";
export const HEARTBEAT_ACK = "HB_ACK";

const encoder = new TextEncoder();

export function encodeCommand(command: Command): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${CMD_PREFIX}${command}\n`);
}

export function encodeHeartbeat(): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${HEARTBEAT}\n`);
}

export type DecodedFrame =
  | { kind: "ACK"; payload: string }
  | { kind: "STATE"; payload: string }
  | { kind: "HB_ACK"; payload: "" };

export function decodeLine(rawLine: string): DecodedFrame | null {
  const line = rawLine.trim();
  if (!line) return null;
  if (line === HEARTBEAT_ACK) return { kind: "HB_ACK", payload: "" };
  if (line.startsWith(ACK_PREFIX)) return { kind: "ACK", payload: line.slice(ACK_PREFIX.length) };
  if (line.startsWith(STATE_PREFIX)) return { kind: "STATE", payload: line.slice(STATE_PREFIX.length) };
  return null;
}
