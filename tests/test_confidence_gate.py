"""Tests for classification/confidence_gate.py — the final HOLD-safe gate.

Per docs/SAFETY.md: HOLD is the fail-safe default. A non-HOLD command may
only be produced for a DOUBLE_BLINK_CONFIRMED event at high confidence, with
good signal quality and healthy communication. Every other combination —
medium/low confidence, poor signal, comm loss, no event, single blinks
(currently unmapped) — must resolve to HOLD.
"""
from __future__ import annotations

from bcihand.classification.command_mapper import Command, HandStateTracker
from bcihand.classification.confidence_gate import ConfidenceLevel, classify_confidence_level, gate_event
from bcihand.classification.state_machine import BlinkEventType, BlinkStateMachineEvent

MAPPING = {"double_blink": "TOGGLE_OPEN_CLOSE", "single_blink": "NONE", "uncertain": "HOLD"}
HIGH_T, MED_T = 0.80, 0.55


def _double_event(confidence: float) -> BlinkStateMachineEvent:
    return BlinkStateMachineEvent(
        event_type=BlinkEventType.DOUBLE_BLINK_CONFIRMED,
        timestamp_s=1.0, first_blink_timestamp_s=0.75, second_blink_timestamp_s=1.0,
        inter_blink_interval_s=0.25, confidence=confidence,
    )


def _single_event(confidence: float) -> BlinkStateMachineEvent:
    return BlinkStateMachineEvent(
        event_type=BlinkEventType.SINGLE_BLINK_CONFIRMED,
        timestamp_s=1.0, first_blink_timestamp_s=1.0, second_blink_timestamp_s=None,
        inter_blink_interval_s=None, confidence=confidence,
    )


def test_high_confidence_double_blink_produces_command():
    tracker = HandStateTracker()
    decision = gate_event(_double_event(0.95), True, True, HIGH_T, MED_T, MAPPING, tracker)
    assert decision.command == Command.OPEN
    assert decision.confidence_level == ConfidenceLevel.HIGH


def test_medium_confidence_double_blink_holds():
    tracker = HandStateTracker()
    decision = gate_event(_double_event(0.65), True, True, HIGH_T, MED_T, MAPPING, tracker)
    assert decision.command == Command.HOLD
    assert decision.reason == "medium_confidence"


def test_low_confidence_double_blink_holds():
    tracker = HandStateTracker()
    decision = gate_event(_double_event(0.2), True, True, HIGH_T, MED_T, MAPPING, tracker)
    assert decision.command == Command.HOLD
    assert decision.reason == "low_confidence"


def test_poor_signal_quality_forces_hold_even_at_high_confidence():
    tracker = HandStateTracker()
    decision = gate_event(_double_event(0.99), False, True, HIGH_T, MED_T, MAPPING, tracker)
    assert decision.command == Command.HOLD
    assert decision.reason == "poor_signal_quality"


def test_comm_loss_forces_hold_even_at_high_confidence():
    tracker = HandStateTracker()
    decision = gate_event(_double_event(0.99), True, False, HIGH_T, MED_T, MAPPING, tracker)
    assert decision.command == Command.HOLD
    assert decision.reason == "communication_lost"


def test_comm_loss_takes_priority_over_signal_quality():
    tracker = HandStateTracker()
    decision = gate_event(_double_event(0.99), False, False, HIGH_T, MED_T, MAPPING, tracker)
    assert decision.reason == "communication_lost"


def test_no_event_holds():
    tracker = HandStateTracker()
    decision = gate_event(None, True, True, HIGH_T, MED_T, MAPPING, tracker)
    assert decision.command == Command.HOLD
    assert decision.reason == "no_event"


def test_single_blink_always_holds_when_unmapped():
    tracker = HandStateTracker()
    decision = gate_event(_single_event(0.99), True, True, HIGH_T, MED_T, MAPPING, tracker)
    assert decision.command == Command.HOLD
    assert decision.reason == "single_blink_unmapped"


def test_confidence_level_boundaries():
    assert classify_confidence_level(0.80, HIGH_T, MED_T) == ConfidenceLevel.HIGH
    assert classify_confidence_level(0.79999, HIGH_T, MED_T) == ConfidenceLevel.MEDIUM
    assert classify_confidence_level(0.55, HIGH_T, MED_T) == ConfidenceLevel.MEDIUM
    assert classify_confidence_level(0.1, HIGH_T, MED_T) == ConfidenceLevel.LOW


def test_double_blink_toggle_alternates_open_close_across_events():
    tracker = HandStateTracker()
    d1 = gate_event(_double_event(0.9), True, True, HIGH_T, MED_T, MAPPING, tracker)
    d2 = gate_event(_double_event(0.9), True, True, HIGH_T, MED_T, MAPPING, tracker)
    assert d1.command == Command.OPEN
    assert d2.command == Command.CLOSE
