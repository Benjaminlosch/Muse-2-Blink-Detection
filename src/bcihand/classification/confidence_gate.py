"""Confidence / safety gate — the last stop before a command leaves the PC.

HOLD is the fail-safe default (see docs/SAFETY.md). A command other than HOLD
is only produced when ALL of the following hold:
  - a DOUBLE_BLINK_CONFIRMED event was just produced by the state machine,
  - its confidence is >= high_confidence_threshold,
  - signal quality is acceptable,
  - communication to the ESP32 is currently healthy.

Medium/low confidence, poor signal quality, and comm loss all resolve to
HOLD — never to "pick the nearest class anyway."
"""
from __future__ import annotations

import enum
from dataclasses import dataclass

from .command_mapper import Command, HandStateTracker, resolve_command_mapping
from .state_machine import BlinkStateMachineEvent, BlinkEventType


class ConfidenceLevel(enum.Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    NONE = "NONE"  # no event to evaluate


@dataclass
class GateDecision:
    command: Command
    confidence_level: ConfidenceLevel
    reason: str


def classify_confidence_level(confidence: float, high_threshold: float, medium_threshold: float) -> ConfidenceLevel:
    if confidence >= high_threshold:
        return ConfidenceLevel.HIGH
    if confidence >= medium_threshold:
        return ConfidenceLevel.MEDIUM
    return ConfidenceLevel.LOW


def gate_event(
    event: BlinkStateMachineEvent | None,
    signal_quality_ok: bool,
    comm_ok: bool,
    high_confidence_threshold: float,
    medium_confidence_threshold: float,
    command_mapping: dict,
    hand_state: HandStateTracker,
) -> GateDecision:
    if not comm_ok:
        return GateDecision(Command.HOLD, ConfidenceLevel.NONE, "communication_lost")

    if not signal_quality_ok:
        return GateDecision(Command.HOLD, ConfidenceLevel.NONE, "poor_signal_quality")

    if event is None:
        return GateDecision(Command.HOLD, ConfidenceLevel.NONE, "no_event")

    level = classify_confidence_level(event.confidence, high_confidence_threshold, medium_confidence_threshold)

    if event.event_type == BlinkEventType.SINGLE_BLINK_CONFIRMED:
        # Reserved for future use; presently always resolves to HOLD via
        # command_mapping.single_blink == "NONE".
        cmd = resolve_command_mapping("single_blink", command_mapping, hand_state)
        return GateDecision(cmd, level, "single_blink_unmapped" if cmd == Command.HOLD else "single_blink_mapped")

    if event.event_type == BlinkEventType.DOUBLE_BLINK_CONFIRMED:
        if level != ConfidenceLevel.HIGH:
            reason = "medium_confidence" if level == ConfidenceLevel.MEDIUM else "low_confidence"
            return GateDecision(Command.HOLD, level, reason)
        cmd = resolve_command_mapping("double_blink", command_mapping, hand_state)
        return GateDecision(cmd, level, "double_blink_confirmed_high_confidence")

    return GateDecision(Command.HOLD, ConfidenceLevel.NONE, "unhandled_event_type")
