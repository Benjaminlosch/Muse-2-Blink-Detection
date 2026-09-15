"""Spatial (multi-channel) combination logic.

We never threshold a single EEG channel in isolation. This module derives the
signals the detector actually runs on, and provides an AF7/AF8 agreement
check used later as an artifact-rejection gate.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def frontal_mean(af7: np.ndarray | float, af8: np.ndarray | float):
    """(AF7 + AF8) / 2 — the primary bilateral ocular-activity signal.

    Genuine blinks produce a strong, correlated deflection on both frontal
    electrodes, so the mean has a good SNR for the underlying eye-movement
    dipole while partially cancelling channel-independent noise.
    """
    return (af7 + af8) / 2.0


def frontal_difference(af7: np.ndarray | float, af8: np.ndarray | float):
    """AF7 - AF8 — sensitive to asymmetric events (single-electrode artifacts,
    lateral eye movement, localized noise) rather than symmetric blinks.
    Large frontal_difference relative to frontal_mean is used as a rejection
    cue, not as a blink feature by itself.
    """
    return af7 - af8


@dataclass
class AgreementResult:
    correlation: float
    amplitude_ratio: float
    agrees: bool


def check_af7_af8_agreement(
    af7_window: np.ndarray,
    af8_window: np.ndarray,
    min_correlation: float = 0.6,
    max_amplitude_ratio: float = 3.0,
) -> AgreementResult:
    """Check whether an AF7/AF8 candidate window looks like a genuine bilateral
    ocular event rather than single-electrode noise / localized artifact / bad
    contact.

    Two conditions must both hold:
      1. The two channels are reasonably correlated over the window (a real
         blink deflects both electrodes together in time).
      2. Neither channel dominates the other by more than max_amplitude_ratio
         (a single dead/noisy electrode tends to blow this up).
    """
    af7_window = np.asarray(af7_window, dtype=np.float64)
    af8_window = np.asarray(af8_window, dtype=np.float64)

    if len(af7_window) < 2 or len(af8_window) < 2:
        return AgreementResult(correlation=0.0, amplitude_ratio=np.inf, agrees=False)

    if np.std(af7_window) < 1e-9 or np.std(af8_window) < 1e-9:
        correlation = 0.0
    else:
        correlation = float(np.corrcoef(af7_window, af8_window)[0, 1])
        if np.isnan(correlation):
            correlation = 0.0

    amp7 = float(np.max(np.abs(af7_window)))
    amp8 = float(np.max(np.abs(af8_window)))
    lo, hi = sorted([amp7, amp8])
    amplitude_ratio = (hi / lo) if lo > 1e-9 else np.inf

    agrees = (correlation >= min_correlation) and (amplitude_ratio <= max_amplitude_ratio)
    return AgreementResult(correlation=correlation, amplitude_ratio=amplitude_ratio, agrees=agrees)
