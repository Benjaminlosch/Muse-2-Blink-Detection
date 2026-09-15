"""Causal, sample-by-sample DSP building blocks for the real-time pipeline.

Everything in this module processes one sample at a time (or loops sample-by-
-sample over a block) and keeps explicit filter state between calls, matching
the eventual ESP32 execution model (see firmware/esp32/src/dsp.cpp, which
implements the numerically-equivalent biquad math in C++).

IMPORTANT: Nothing in this file uses scipy.signal.filtfilt or any other
non-causal / future-sample-dependent operation. Zero-phase filtering for
offline visualization/comparison lives in `offline.py` and is clearly labeled
OFFLINE ONLY there — never import it into the production real-time path.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.signal import butter, iirnotch, sosfilt, tf2sos


def design_bandpass_sos(fs_hz: float, highpass_hz: float, lowpass_hz: float, order: int = 2) -> np.ndarray:
    """Causal Butterworth bandpass filter as second-order sections (SOS).

    `order` is the scipy Butterworth prototype order (a good default for a
    low-latency, low-order causal filter that is cheap to re-implement as a
    handful of biquads on an MCU). Second-order sections are used (rather than
    raw b/a transfer-function coefficients) because SOS is numerically stable
    at low orders and maps 1:1 onto biquad sections in embedded C++.
    """
    nyquist = fs_hz / 2.0
    low = highpass_hz / nyquist
    high = lowpass_hz / nyquist
    if not (0 < low < high < 1):
        raise ValueError(
            f"Invalid band for fs={fs_hz}: highpass={highpass_hz}, lowpass={lowpass_hz}"
        )
    sos = butter(order, [low, high], btype="bandpass", output="sos")
    return sos


def design_notch_sos(fs_hz: float, notch_hz: float, quality_factor: float = 30.0) -> np.ndarray:
    """Causal IIR notch filter (single biquad) as SOS."""
    b, a = iirnotch(w0=notch_hz, Q=quality_factor, fs=fs_hz)
    return tf2sos(b, a)


class StreamingSOS:
    """A cascade of second-order sections with persistent state (causal, online)."""

    def __init__(self, sos: np.ndarray):
        self.sos = np.asarray(sos, dtype=np.float64)
        n_sections = self.sos.shape[0]
        # zi shape required by scipy: (n_sections, 2)
        self.zi = np.zeros((n_sections, 2), dtype=np.float64)

    def process_sample(self, x: float) -> float:
        y, self.zi = sosfilt(self.sos, np.array([x], dtype=np.float64), zi=self.zi)
        return float(y[0])

    def process_block(self, x: np.ndarray) -> np.ndarray:
        out = np.empty(len(x), dtype=np.float64)
        for i, xi in enumerate(x):
            out[i] = self.process_sample(xi)
        return out

    def reset(self) -> None:
        self.zi[:] = 0.0


@dataclass
class AdaptiveBaselineTracker:
    """Slow exponential-moving-average baseline for DC removal / drift rejection.

    A single multiply-add per sample (trivially portable to an MCU). This
    complements, rather than replaces, the high-pass corner of the Butterworth
    band: it tracks baseline wander that is slower than the high-pass corner
    would otherwise let through without introducing extra filter phase.
    """

    fs_hz: float
    time_constant_s: float
    _baseline: float = field(default=0.0, init=False)
    _initialized: bool = field(default=False, init=False)

    @property
    def alpha(self) -> float:
        # Standard EMA time-constant -> alpha mapping for a sample period dt.
        dt = 1.0 / self.fs_hz
        return dt / (self.time_constant_s + dt)

    def process_sample(self, x: float) -> float:
        if not self._initialized:
            self._baseline = x
            self._initialized = True
        else:
            a = self.alpha
            self._baseline = self._baseline + a * (x - self._baseline)
        return x - self._baseline

    def process_block(self, x: np.ndarray) -> np.ndarray:
        out = np.empty(len(x), dtype=np.float64)
        for i, xi in enumerate(x):
            out[i] = self.process_sample(xi)
        return out

    @property
    def baseline(self) -> float:
        return self._baseline

    def reset(self) -> None:
        self._baseline = 0.0
        self._initialized = False


class CausalBlinkBandFilter:
    """The full causal per-channel filter chain used in production:

    adaptive baseline removal -> Butterworth bandpass (SOS) -> optional 60 Hz notch (SOS)

    One instance per channel; state is per-instance and never resets itself
    mid-stream (call .reset() explicitly, e.g. on electrode dropout recovery).
    """

    def __init__(
        self,
        fs_hz: float,
        highpass_hz: float,
        lowpass_hz: float,
        order: int = 2,
        notch_hz: float | None = 60.0,
        notch_q: float = 30.0,
        baseline_time_constant_s: float = 4.0,
    ):
        self.fs_hz = fs_hz
        self.baseline_tracker = AdaptiveBaselineTracker(fs_hz, baseline_time_constant_s)
        self.bandpass = StreamingSOS(design_bandpass_sos(fs_hz, highpass_hz, lowpass_hz, order))
        self.notch: StreamingSOS | None = None
        if notch_hz:
            self.notch = StreamingSOS(design_notch_sos(fs_hz, notch_hz, notch_q))

    def process_sample(self, x: float) -> float:
        y = self.baseline_tracker.process_sample(x)
        y = self.bandpass.process_sample(y)
        if self.notch is not None:
            y = self.notch.process_sample(y)
        return y

    def process_block(self, x: np.ndarray) -> np.ndarray:
        out = np.empty(len(x), dtype=np.float64)
        for i, xi in enumerate(x):
            out[i] = self.process_sample(xi)
        return out

    def reset(self) -> None:
        self.baseline_tracker.reset()
        self.bandpass.reset()
        if self.notch is not None:
            self.notch.reset()
