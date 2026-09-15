import { describe, expect, it } from "vitest";
import { decodeLine, encodeCommand, encodeHeartbeat } from "./protocol";

describe("esp32/protocol", () => {
  it("encodes commands identically to communication/protocol.py", () => {
    expect(new TextDecoder().decode(encodeCommand("OPEN"))).toBe("CMD:OPEN\n");
    expect(new TextDecoder().decode(encodeCommand("CLOSE"))).toBe("CMD:CLOSE\n");
    expect(new TextDecoder().decode(encodeCommand("HOLD"))).toBe("CMD:HOLD\n");
  });

  it("encodes heartbeat identically to communication/protocol.py", () => {
    expect(new TextDecoder().decode(encodeHeartbeat())).toBe("HEARTBEAT\n");
  });

  it("decodes ACK frames", () => {
    expect(decodeLine("ACK:OPEN")).toEqual({ kind: "ACK", payload: "OPEN" });
  });

  it("decodes STATE frames", () => {
    expect(decodeLine("STATE:HOLD")).toEqual({ kind: "STATE", payload: "HOLD" });
  });

  it("decodes heartbeat ack", () => {
    expect(decodeLine("HB_ACK")).toEqual({ kind: "HB_ACK", payload: "" });
  });

  it("returns null for unrecognized or empty lines", () => {
    expect(decodeLine("garbage")).toBeNull();
    expect(decodeLine("")).toBeNull();
    expect(decodeLine("   ")).toBeNull();
  });
});
