"""Tests for classification/state_machine.py — the single/double-blink timing FSM.

Per project brief section 7: a double blink must never be merely "two
threshold crossings." Everything fed into process_valid_blink() here is
assumed already independently validated upstream; this module's only job is
timing, debounce, and refractory logic.
"""
from __future__ import annotations

from bcihand.classification.state_machine import BlinkEventType, DoubleBlinkStateMachine


def make_sm(**overrides):
    defaults = dict(min_interval_s=0.08, max_interval_s=0.60, wait_for_second_timeout_s=0.70, refractory_after_double_s=0.50)
    defaults.update(overrides)
    return DoubleBlinkStateMachine(**defaults)


def test_two_blinks_within_window_confirm_double_blink():
    sm = make_sm()
    assert sm.process_valid_blink(0.0, 0.9) is None
    assert sm.state == "WAIT_FOR_SECOND"

    event = sm.process_valid_blink(0.25, 0.85)
    assert event is not None
    assert event.event_type == BlinkEventType.DOUBLE_BLINK_CONFIRMED
    assert event.inter_blink_interval_s == 0.25
    assert event.confidence == 0.85  # min of the two contributing confidences
    assert sm.state == "REFRACTORY"


def test_too_close_second_blink_is_treated_as_ringing_not_a_second_blink():
    sm = make_sm()
    sm.process_valid_blink(0.0, 0.9)
    # Chatter well inside min_interval_s (ringing from the same physical blink).
    event = sm.process_valid_blink(0.03, 0.9)
    assert event is None
    assert sm.state == "WAIT_FOR_SECOND"  # still waiting for a genuine second blink

    # A genuine second blink can still arrive and complete the double blink.
    event2 = sm.process_valid_blink(0.25, 0.9)
    assert event2 is not None
    assert event2.event_type == BlinkEventType.DOUBLE_BLINK_CONFIRMED
    assert event2.first_blink_timestamp_s == 0.0  # original first blink, not the chatter


def test_second_blink_too_slow_starts_a_fresh_sequence():
    sm = make_sm()
    sm.process_valid_blink(0.0, 0.9)
    # Between max_interval_s (0.60) and wait_for_second_timeout_s (0.70):
    # too slow for a double blink, but not yet timed out either.
    event = sm.process_valid_blink(0.65, 0.9)
    assert event is None
    assert sm.state == "WAIT_FOR_SECOND"

    # This blink becomes a fresh "blink 1" — a further blink close behind it
    # can now form a double blink.
    event2 = sm.process_valid_blink(0.80, 0.9)
    assert event2 is not None
    assert event2.first_blink_timestamp_s == 0.65


def test_refractory_period_debounces_blinks_after_confirmed_double():
    sm = make_sm()
    sm.process_valid_blink(0.0, 0.9)
    sm.process_valid_blink(0.25, 0.9)
    assert sm.state == "REFRACTORY"

    # A blink landing inside the refractory window must be fully ignored.
    event = sm.process_valid_blink(0.30, 0.9)
    assert event is None
    assert sm.state == "REFRACTORY"


def test_refractory_expires_via_poll_timeout():
    sm = make_sm(refractory_after_double_s=0.50)
    sm.process_valid_blink(0.0, 0.9)
    sm.process_valid_blink(0.25, 0.9)  # confirms double at t=0.25, refractory until 0.75
    assert sm.poll_timeout(0.70) is None
    assert sm.state == "REFRACTORY"
    assert sm.poll_timeout(0.80) is None
    assert sm.state == "IDLE"


def test_single_blink_confirmed_on_wait_timeout():
    sm = make_sm(wait_for_second_timeout_s=0.70)
    sm.process_valid_blink(0.0, 0.9)
    assert sm.poll_timeout(0.5) is None  # not yet timed out
    event = sm.poll_timeout(0.71)
    assert event is not None
    assert event.event_type == BlinkEventType.SINGLE_BLINK_CONFIRMED
    assert sm.state == "IDLE"


def test_single_blink_emission_can_be_disabled():
    sm2 = DoubleBlinkStateMachine(
        min_interval_s=0.08, max_interval_s=0.60, wait_for_second_timeout_s=0.70,
        refractory_after_double_s=0.50, emit_single_on_timeout=False,
    )
    sm2.process_valid_blink(0.0, 0.9)
    event = sm2.poll_timeout(0.71)
    assert event is None
    assert sm2.state == "IDLE"


def test_one_long_blink_cannot_produce_a_double_blink_by_itself():
    # A single upstream-validated blink event, by itself, can never yield a
    # DOUBLE_BLINK_CONFIRMED — only a second independently-validated blink can.
    sm = make_sm()
    event = sm.process_valid_blink(0.0, 0.95)
    assert event is None
    for t in (0.05, 0.10, 0.15):
        # Even repeated calls representing filter ringing on the same blink,
        # if spaced under min_interval_s, never confirm a double on their own.
        event = sm.process_valid_blink(t, 0.95)
        if t - 0.0 < 0.08:
            assert event is None


def test_reset_returns_to_idle():
    sm = make_sm()
    sm.process_valid_blink(0.0, 0.9)
    sm.reset()
    assert sm.state == "IDLE"
