/**
 * Confidence / safety gate — port of classification/confidence_gate.py.
 * HOLD is the fail-safe default. See docs/SAFETY.md.
 */
import type { BlinkStateMachineEvent, ConfidenceLevel, GateDecision } from "../types";
import { HandStateTracker, resolveCommandMapping } from "./commandMapper";

export function classifyConfidenceLevel(confidence: number, highThreshold: number, mediumThreshold: number): ConfidenceLevel {
  if (confidence >= highThreshold) return "HIGH";
  if (confidence >= mediumThreshold) return "MEDIUM";
  return "LOW";
}

export function gateEvent(
  event: BlinkStateMachineEvent | null,
  signalQualityOk: boolean,
  commOk: boolean,
  highConfidenceThreshold: number,
  mediumConfidenceThreshold: number,
  commandMapping: Record<string, string>,
  handState: HandStateTracker,
): GateDecision {
  if (!commOk) return { command: "HOLD", confidenceLevel: "NONE", reason: "communication_lost" };
  if (!signalQualityOk) return { command: "HOLD", confidenceLevel: "NONE", reason: "poor_signal_quality" };
  if (event === null) return { command: "HOLD", confidenceLevel: "NONE", reason: "no_event" };

  const level = classifyConfidenceLevel(event.confidence, highConfidenceThreshold, mediumConfidenceThreshold);

  if (event.eventType === "SINGLE_BLINK_CONFIRMED") {
    const cmd = resolveCommandMapping("singleBlink", commandMapping, handState);
    return { command: cmd, confidenceLevel: level, reason: cmd === "HOLD" ? "single_blink_unmapped" : "single_blink_mapped" };
  }

  if (event.eventType === "DOUBLE_BLINK_CONFIRMED") {
    if (level !== "HIGH") {
      const reason = level === "MEDIUM" ? "medium_confidence" : "low_confidence";
      return { command: "HOLD", confidenceLevel: level, reason };
    }
    const cmd = resolveCommandMapping("doubleBlink", commandMapping, handState);
    return { command: cmd, confidenceLevel: level, reason: "double_blink_confirmed_high_confidence" };
  }

  return { command: "HOLD", confidenceLevel: "NONE", reason: "unhandled_event_type" };
}
