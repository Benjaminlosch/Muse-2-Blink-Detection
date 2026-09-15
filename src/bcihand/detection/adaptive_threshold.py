"""Robust, adaptive amplitude threshold for candidate detection.

Uses median / MAD (median absolute deviation) rather than mean/std, per the
project brief: robust statistics resist being dragged around by the very
outliers (spikes, artifacts) we're trying to threshold against.

NOTE for embedded port: recomputing an exact median/MAD over a multi-second
rolling buffer is O(n log n) and too expensive for a tight MCU loop. On the
ESP32 this should become a cheaper running-percentile approximation (e.g. a
stochastic/streaming quantile estimator) — tracked in docs/SIGNAL_PIPELINE.md.
On the PC this exact form is fine and gives us a correctness baseline to
approximate against later.
"""
from __future__ import annotations

from collections import deque

import numpy as np

MAD_TO_SIGMA = 1.4826  # consistency constant for a normal distribution


class AdaptiveThreshold:
    def __init__(
        self,
        fs_hz: float,
        window_s: float = 10.0,
        mad_multiplier: float = 4.0,
        update_interval_samples: int = 32,
        min_threshold: float = 1e-6,
    ):
        self.fs_hz = fs_hz
        self.maxlen = max(int(window_s * fs_hz), 8)
        self.mad_multiplier = mad_multiplier
        self.update_interval_samples = update_interval_samples
        self.min_threshold = min_threshold

        self._buffer: deque[float] = deque(maxlen=self.maxlen)
        self._samples_since_update = 0
        self._median = 0.0
        self._mad = 0.0
        self._threshold = min_threshold

    def update(self, abs_sample_value: float, in_candidate: bool = False) -> float:
        """Feed one (rectified/abs) filtered sample; returns the current threshold.

        Samples flagged `in_candidate=True` (i.e. part of an active blink
        candidate) are excluded from the noise-floor estimate so genuine
        blinks don't inflate their own detection threshold.
        """
        if not in_candidate:
            self._buffer.append(abs_sample_value)
            self._samples_since_update += 1

        if self._samples_since_update >= self.update_interval_samples and len(self._buffer) >= 8:
            arr = np.fromiter(self._buffer, dtype=np.float64, count=len(self._buffer))
            self._median = float(np.median(arr))
            self._mad = float(np.median(np.abs(arr - self._median)))
            self._threshold = max(
                self._median + self.mad_multiplier * MAD_TO_SIGMA * self._mad,
                self.min_threshold,
            )
            self._samples_since_update = 0

        return self._threshold

    @property
    def threshold(self) -> float:
        return self._threshold

    @property
    def noise_floor_median(self) -> float:
        return self._median

    @property
    def noise_floor_mad(self) -> float:
        return self._mad

    def seed(self, samples: np.ndarray) -> None:
        """Bulk-seed the buffer (used right after calibration) so the threshold
        is meaningful immediately instead of ramping up from zero."""
        for s in samples:
            self._buffer.append(float(abs(s)))
        self._samples_since_update = self.update_interval_samples  # force recompute
        self.update(0.0, in_candidate=True)  # trigger recompute without adding a sample
