"""Single/double-blink temporal state machine.

Per project brief section 7: a double blink is NEVER just "two threshold
crossings." Every blink fed into this state machine must already have passed
independent validation (candidate detection -> features -> artifact rejection
-> classifier, all upstream of this file). This module's only job is timing:
deciding whether two already-valid blinks are close enough together to count
as one double-blink event, with debounce/refractory logic so that:

  - one long blink,
  - filter ringing / multiple threshold crossings within one blink,
  - a blink immediately followed by an electrode spike,

cannot masquerade as a double blink.

    IDLE -> BLINK_1_DETECTED -> WAIT_FOR_SECOND -> SECOND_VALID_BLINK ->
    DOUBLE_BLINK_CONFIRMED -> REFRACTORY -> IDLE

If WAIT_FOR_SECOND times out, the first blink alone is reported as a
SINGLE_BLINK_CONFIRMED event (see config command_mapping — single blink is
presently unmapped/ignored downstream, but the state machine still reports it
so it's visible in logs/recordings for future tuning).
"""
from __future__ import annotations

import enum
from dataclasses import dataclass


class BlinkEventType(enum.Enum):
    SINGLE_BLINK_CONFIRMED = "SINGLE_BLINK_CONFIRMED"
    DOUBLE_BLINK_CONFIRMED = "DOUBLE_BLINK_CONFIRMED"


class _State(enum.Enum):
    IDLE = "IDLE"
    WAIT_FOR_SECOND = "WAIT_FOR_SECOND"
    REFRACTORY = "REFRACTORY"


@dataclass
class BlinkStateMachineEvent:
    event_type: BlinkEventType
    timestamp_s: float
    first_blink_timestamp_s: float
    second_blink_timestamp_s: float | None
    inter_blink_interval_s: float | None
    confidence: float  # min confidence of the contributing blink(s)


class DoubleBlinkStateMachine:
    def __init__(
        self,
        min_interval_s: float = 0.08,
        max_interval_s: float = 0.60,
        wait_for_second_timeout_s: float = 0.70,
        refractory_after_double_s: float = 0.50,
        emit_single_on_timeout: bool = True,
    ):
        self.min_interval_s = min_interval_s
        self.max_interval_s = max_interval_s
        self.wait_for_second_timeout_s = wait_for_second_timeout_s
        self.refractory_after_double_s = refractory_after_double_s
        self.emit_single_on_timeout = emit_single_on_timeout

        self._state = _State.IDLE
        self._first_blink_time: float | None = None
        self._first_blink_confidence: float = 0.0
        self._refractory_until: float | None = None

    @property
    def state(self) -> str:
        return self._state.value

    def poll_timeout(self, now_s: float) -> BlinkStateMachineEvent | None:
        """Call periodically (or before processing the next blink) so a
        WAIT_FOR_SECOND timeout can resolve to a single-blink event even if
        no further blink ever arrives (e.g. the operator only blinked once)."""
        if self._state == _State.WAIT_FOR_SECOND and self._first_blink_time is not None:
            if now_s - self._first_blink_time > self.wait_for_second_timeout_s:
                event = None
                if self.emit_single_on_timeout:
                    event = BlinkStateMachineEvent(
                        event_type=BlinkEventType.SINGLE_BLINK_CONFIRMED,
                        timestamp_s=now_s,
                        first_blink_timestamp_s=self._first_blink_time,
                        second_blink_timestamp_s=None,
                        inter_blink_interval_s=None,
                        confidence=self._first_blink_confidence,
                    )
                self._to_idle()
                return event

        if self._state == _State.REFRACTORY and self._refractory_until is not None:
            if now_s >= self._refractory_until:
                self._state = _State.IDLE
                self._refractory_until = None

        return None

    def process_valid_blink(self, timestamp_s: float, confidence: float) -> BlinkStateMachineEvent | None:
        """Feed one already-validated blink event's timestamp (seconds,
        monotonic clock) and confidence. Returns a confirmed event if this
        blink completes one (single-on-timeout is handled via poll_timeout,
        not here, since it depends on the ABSENCE of a blink)."""
        timeout_event = self.poll_timeout(timestamp_s)
        if timeout_event is not None:
            # A pending single blink resolved before this new one arrived;
            # this new blink starts a fresh sequence below. The caller should
            # treat timeout_event as its own independent output.
            pass

        if self._state == _State.REFRACTORY:
            # Inside refractory: this blink is debounced away entirely
            # (protects against ringing/bounce immediately after a confirmed
            # double blink).
            return None

        if self._state == _State.IDLE:
            self._state = _State.WAIT_FOR_SECOND
            self._first_blink_time = timestamp_s
            self._first_blink_confidence = confidence
            return None

        if self._state == _State.WAIT_FOR_SECOND:
            assert self._first_blink_time is not None
            interval = timestamp_s - self._first_blink_time

            if interval < self.min_interval_s:
                # Too close together: treat as ringing/bounce from the same
                # physical blink, not a second distinct blink. Ignore this
                # sample entirely (stay in WAIT_FOR_SECOND for a real second
                # blink) rather than resetting, so a genuine fast double
                # blink immediately after isn't punished.
                return None

            if interval <= self.max_interval_s:
                event = BlinkStateMachineEvent(
                    event_type=BlinkEventType.DOUBLE_BLINK_CONFIRMED,
                    timestamp_s=timestamp_s,
                    first_blink_timestamp_s=self._first_blink_time,
                    second_blink_timestamp_s=timestamp_s,
                    inter_blink_interval_s=interval,
                    confidence=min(self._first_blink_confidence, confidence),
                )
                self._state = _State.REFRACTORY
                self._refractory_until = timestamp_s + self.refractory_after_double_s
                self._first_blink_time = None
                return event

            # interval > max_interval_s: too slow to be a double blink.
            # Per timeout semantics this really should already have resolved
            # via poll_timeout; handle it defensively here too by starting a
            # fresh sequence with this blink as blink 1.
            self._first_blink_time = timestamp_s
            self._first_blink_confidence = confidence
            return None

        return None

    def _to_idle(self) -> None:
        self._state = _State.IDLE
        self._first_blink_time = None
        self._first_blink_confidence = 0.0

    def reset(self) -> None:
        self._to_idle()
        self._refractory_until = None
