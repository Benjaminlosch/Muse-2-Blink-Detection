"""Causal streaming blink-candidate detector.

State machine (per sample):

    BELOW_THRESHOLD --(|frontal| crosses above adaptive threshold)--> ABOVE_THRESHOLD
    ABOVE_THRESHOLD --(frontal crosses back through zero, OR |frontal| falls
                        below release_ratio*threshold, OR max width exceeded)
                     --> emit candidate -> REFRACTORY -> BELOW_THRESHOLD

A candidate ends at the first ZERO CROSSING after the triggering excursion,
not merely when its magnitude drops below the release threshold. A causal
high-pass/bandpass filter driven by a blink-width pulse commonly produces a
sizeable opposite-sign rebound immediately afterward (measured directly on
this project's own filter chain: a ~90 uV, 180 ms blink pulse through the
default 0.5-20 Hz order-2 Butterworth band produces a ~45-50 uV negative
rebound with no sample landing back near zero in between) — ending the
candidate on magnitude alone would merge the true blink and its rebound (or
the rebound and a genuinely following second blink) into one blob. Ending on
zero-crossing instead isolates each lobe.

That rebound lobe will still cross the detection threshold on its own and
become its own candidate — this is expected (matches the "rebound filtering"
technique described in López-Ahumada et al. 2023, see docs/research_review.md
Paper 4) and is handled explicitly: any candidate whose peak is the OPPOSITE
sign of, and starts soon after, the most recently accepted (non-rebound,
width-valid) candidate is flagged `likely_filter_rebound=True` so the
classifier hard-rejects it rather than ever reaching the state machine.

This only ever looks at samples up to "now" (a rolling buffer of recent
past), so it is causal and portable to sample-by-sample MCU execution. It
does not itself decide whether a candidate is a real blink — that's the job
of feature extraction + artifact rejection + classifier downstream.
"""
from __future__ import annotations

import enum
from collections import deque
from dataclasses import dataclass

import numpy as np

from .adaptive_threshold import AdaptiveThreshold


class _State(enum.Enum):
    BELOW_THRESHOLD = "BELOW_THRESHOLD"
    ABOVE_THRESHOLD = "ABOVE_THRESHOLD"
    REFRACTORY = "REFRACTORY"


@dataclass
class BlinkCandidate:
    start_idx: int
    end_idx: int
    start_time_s: float
    end_time_s: float
    duration_s: float
    frontal_window: np.ndarray
    af7_window: np.ndarray
    af8_window: np.ndarray
    threshold_at_detection: float
    width_valid: bool  # within [min_blink_width_s, max_blink_width_s], and not truncated
    peak_sign: int  # +1 or -1
    likely_filter_rebound: bool = False


class CandidateDetector:
    def __init__(
        self,
        fs_hz: float,
        min_blink_width_s: float = 0.06,
        max_blink_width_s: float = 0.40,
        refractory_after_candidate_s: float = 0.15,
        release_ratio: float = 0.35,
        threshold_window_s: float = 10.0,
        threshold_mad_multiplier: float = 4.0,
        rebound_guard_s: float = 0.30,
        rebound_refractory_s: float = 0.02,
    ):
        self.fs_hz = fs_hz
        self.dt = 1.0 / fs_hz
        self.min_width_samples = max(int(min_blink_width_s * fs_hz), 1)
        self.max_width_samples = max(int(max_blink_width_s * fs_hz), self.min_width_samples + 1)
        self.refractory_samples = int(refractory_after_candidate_s * fs_hz)
        self.release_ratio = release_ratio
        self.rebound_guard_s = rebound_guard_s
        # A rejected filter-rebound lobe gets only a minimal debounce
        # (chatter guard), NOT the full refractory: the full refractory
        # exists to debounce noise around a REAL blink, but a fast genuine
        # double blink can legitimately follow within
        # config.double_blink.min_interval_s (as low as ~80 ms) of the first
        # blink's rebound — applying the full refractory here would eat the
        # real second blink (observed directly: with a 150 ms refractory and
        # a ~150 ms rebound-to-second-blink gap, the entire second blink was
        # masked; see docs/SIGNAL_PIPELINE.md "Filter rebound rejection").
        self.rebound_refractory_samples = max(int(rebound_refractory_s * fs_hz), 1)

        self.threshold = AdaptiveThreshold(
            fs_hz, window_s=threshold_window_s, mad_multiplier=threshold_mad_multiplier
        )

        self._state = _State.BELOW_THRESHOLD
        self._sample_idx = -1
        self._event_start_idx: int | None = None
        self._event_sign = 1
        self._refractory_remaining = 0
        self._pending_extended_wait = False  # only set for truncated (too_long) events

        self._last_accepted_end_time_s: float | None = None
        self._last_accepted_peak_sign: int | None = None

        buf_len = self.max_width_samples + 4
        self._frontal_buf: deque[float] = deque(maxlen=buf_len)
        self._af7_buf: deque[float] = deque(maxlen=buf_len)
        self._af8_buf: deque[float] = deque(maxlen=buf_len)
        self._event_frontal: list[float] = []
        self._event_af7: list[float] = []
        self._event_af8: list[float] = []

    def process_sample(self, frontal: float, af7: float, af8: float) -> BlinkCandidate | None:
        """Feed one filtered sample of frontal_mean, AF7, AF8. Returns a
        BlinkCandidate when an event just completed, else None."""
        self._sample_idx += 1
        idx = self._sample_idx
        self._frontal_buf.append(frontal)
        self._af7_buf.append(af7)
        self._af8_buf.append(af8)

        in_candidate = self._state == _State.ABOVE_THRESHOLD
        thr = self.threshold.update(abs(frontal), in_candidate=in_candidate)

        candidate: BlinkCandidate | None = None

        if self._state == _State.REFRACTORY:
            self._refractory_remaining -= 1
            if self._refractory_remaining <= 0:
                if self._pending_extended_wait:
                    # Only used after a truncated (too_long, never-released)
                    # event: keep waiting, sample by sample, until the signal
                    # actually drops below the release band before re-arming
                    # detection — otherwise a still-elevated oversized
                    # transient would immediately spawn a bogus second
                    # candidate right as refractory ends.
                    if abs(frontal) < self.release_ratio * thr:
                        self._state = _State.BELOW_THRESHOLD
                        self._pending_extended_wait = False
                    else:
                        self._refractory_remaining = 1
                else:
                    self._state = _State.BELOW_THRESHOLD
            return None

        if self._state == _State.BELOW_THRESHOLD:
            if abs(frontal) >= thr:
                self._state = _State.ABOVE_THRESHOLD
                self._event_start_idx = idx
                self._event_sign = 1 if frontal >= 0 else -1
                self._event_frontal = [frontal]
                self._event_af7 = [af7]
                self._event_af8 = [af8]

        elif self._state == _State.ABOVE_THRESHOLD:
            self._event_frontal.append(frontal)
            self._event_af7.append(af7)
            self._event_af8.append(af8)
            width = idx - self._event_start_idx + 1

            crossed_zero = (frontal * self._event_sign) < 0
            magnitude_released = abs(frontal) < self.release_ratio * thr
            too_long = width >= self.max_width_samples

            if crossed_zero or magnitude_released or too_long:
                truncated = too_long and not (crossed_zero or magnitude_released)
                candidate = self._emit_candidate(thr, truncated=truncated)
                self._state = _State.REFRACTORY
                self._refractory_remaining = (
                    self.rebound_refractory_samples if candidate.likely_filter_rebound else self.refractory_samples
                )
                self._pending_extended_wait = truncated

        return candidate

    def _emit_candidate(self, threshold_at_detection: float, truncated: bool = False) -> BlinkCandidate:
        start_idx = self._event_start_idx
        end_idx = start_idx + len(self._event_frontal) - 1
        end_time_s = end_idx * self.dt
        duration_s = (len(self._event_frontal) - 1) * self.dt

        frontal_arr = np.array(self._event_frontal, dtype=np.float64)
        peak_idx = int(np.argmax(np.abs(frontal_arr)))
        peak_sign = 1 if frontal_arr[peak_idx] >= 0 else -1

        # A truncated event (hit max_width before ever releasing) cannot be
        # trusted as a bona fide blink-length event — its true duration is
        # unknown and at least as long as max_blink_width_s.
        width_valid = (
            not truncated
            and self.min_width_samples <= len(self._event_frontal) <= self.max_width_samples
        )

        likely_filter_rebound = False
        if (
            self._last_accepted_end_time_s is not None
            and self._last_accepted_peak_sign is not None
            and peak_sign != self._last_accepted_peak_sign
            and (start_idx * self.dt - self._last_accepted_end_time_s) <= self.rebound_guard_s
        ):
            likely_filter_rebound = True

        if width_valid and not likely_filter_rebound:
            self._last_accepted_end_time_s = end_time_s
            self._last_accepted_peak_sign = peak_sign

        return BlinkCandidate(
            start_idx=start_idx,
            end_idx=end_idx,
            start_time_s=start_idx * self.dt,
            end_time_s=end_time_s,
            duration_s=duration_s,
            frontal_window=frontal_arr,
            af7_window=np.array(self._event_af7, dtype=np.float64),
            af8_window=np.array(self._event_af8, dtype=np.float64),
            threshold_at_detection=threshold_at_detection,
            width_valid=width_valid,
            peak_sign=peak_sign,
            likely_filter_rebound=likely_filter_rebound,
        )

    def reset(self) -> None:
        self._state = _State.BELOW_THRESHOLD
        self._event_start_idx = None
        self._refractory_remaining = 0
        self._pending_extended_wait = False
        self._last_accepted_end_time_s = None
        self._last_accepted_peak_sign = None
        self._frontal_buf.clear()
        self._af7_buf.clear()
        self._af8_buf.clear()
