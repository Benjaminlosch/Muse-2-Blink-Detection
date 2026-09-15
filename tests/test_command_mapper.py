"""Tests for classification/command_mapper.py."""
from __future__ import annotations

from bcihand.classification.command_mapper import Command, HandStateTracker, resolve_command_mapping


def test_toggle_starts_with_open_when_unknown():
    tracker = HandStateTracker()
    assert tracker.last_commanded is None
    assert tracker.toggle() == Command.OPEN
    assert tracker.last_commanded == Command.OPEN


def test_toggle_alternates():
    tracker = HandStateTracker()
    assert tracker.toggle() == Command.OPEN
    assert tracker.toggle() == Command.CLOSE
    assert tracker.toggle() == Command.OPEN


def test_reset_clears_hand_state():
    tracker = HandStateTracker()
    tracker.toggle()
    tracker.toggle()
    tracker.reset()
    assert tracker.last_commanded is None
    assert tracker.toggle() == Command.OPEN


def test_resolve_toggle_intent():
    tracker = HandStateTracker()
    mapping = {"double_blink": "TOGGLE_OPEN_CLOSE"}
    assert resolve_command_mapping("double_blink", mapping, tracker) == Command.OPEN
    assert resolve_command_mapping("double_blink", mapping, tracker) == Command.CLOSE


def test_resolve_explicit_command_updates_hand_state():
    tracker = HandStateTracker()
    mapping = {"double_blink": "OPEN"}
    assert resolve_command_mapping("double_blink", mapping, tracker) == Command.OPEN
    assert tracker.last_commanded == Command.OPEN


def test_unmapped_intent_resolves_to_hold():
    tracker = HandStateTracker()
    mapping = {"single_blink": "NONE"}
    assert resolve_command_mapping("single_blink", mapping, tracker) == Command.HOLD


def test_missing_intent_key_defaults_to_hold():
    tracker = HandStateTracker()
    assert resolve_command_mapping("uncertain", {}, tracker) == Command.HOLD
