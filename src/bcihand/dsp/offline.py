"""OFFLINE-ONLY signal processing utilities.

Everything in this file is for post-hoc visualization / analysis / comparison
against the causal production filters in `filters.py`. Nothing here may be
imported by the real-time pipeline (src/bcihand/pipeline.py) or by any code
that runs on, or is destined to be ported to, the ESP32.

Zero-phase filtering (filtfilt) uses future samples and therefore has zero
lag artifacts, which makes it a fair "ground truth" waveform shape for
comparison plots — but it CANNOT be used in a real-time or embedded system.
"""
from __future__ import annotations

import numpy as np
from scipy.signal import filtfilt

from .filters import design_bandpass_sos, design_notch_sos


def offline_zero_phase_bandpass_FOR_VISUALIZATION_ONLY(
    x: np.ndarray, fs_hz: float, highpass_hz: float, lowpass_hz: float, order: int = 2
) -> np.ndarray:
    """Zero-phase (filtfilt) bandpass. OFFLINE ONLY — do not use in production path."""
    sos = design_bandpass_sos(fs_hz, highpass_hz, lowpass_hz, order)
    from scipy.signal import sosfiltfilt

    return sosfiltfilt(sos, x)


def offline_zero_phase_notch_FOR_VISUALIZATION_ONLY(
    x: np.ndarray, fs_hz: float, notch_hz: float, quality_factor: float = 30.0
) -> np.ndarray:
    """Zero-phase (filtfilt) notch. OFFLINE ONLY — do not use in production path."""
    sos = design_notch_sos(fs_hz, notch_hz, quality_factor)
    from scipy.signal import sosfiltfilt

    return sosfiltfilt(sos, x)
