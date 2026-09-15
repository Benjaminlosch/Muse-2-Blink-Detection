"""Cheap, streaming-friendly feature extraction for a single blink candidate.

Every feature here is O(window_length) with small constants (max/min/sum/diff)
so the same feature set can eventually run on an ESP32 without modification —
no FFTs, no large matrix ops.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np

from ..dsp.spatial import check_af7_af8_agreement


@dataclass
class BlinkFeatures:
    peak_amplitude: float
    abs_peak_amplitude: float
    peak_prominence: float
    positive_excursion: float
    negative_excursion: float
    peak_to_peak_amplitude: float
    duration_s: float
    rise_time_s: float
    fall_time_s: float
    max_slope: float
    area_under_curve: float
    rms: float
    signal_energy: float
    af7_af8_correlation: float
    af7_af8_amplitude_ratio: float
    baseline_deviation: float
    time_since_previous_valid_blink_s: float

    def to_dict(self) -> dict:
        return asdict(self)


def extract_features(
    frontal_window: np.ndarray,
    af7_window: np.ndarray,
    af8_window: np.ndarray,
    fs_hz: float,
    baseline_level: float,
    time_since_previous_valid_blink_s: float,
    agreement_min_correlation: float = 0.6,
    agreement_max_amplitude_ratio: float = 3.0,
) -> BlinkFeatures:
    """Compute the blink feature set for one candidate window.

    `frontal_window` is the filtered frontal_mean signal over the candidate's
    extent (start..end, inclusive), already isolated by the candidate
    detector. `af7_window`/`af8_window` are the matching filtered per-channel
    slices used for the bilateral-agreement features.
    """
    frontal_window = np.asarray(frontal_window, dtype=np.float64)
    n = len(frontal_window)
    dt = 1.0 / fs_hz
    duration_s = max(n - 1, 0) * dt

    peak_idx = int(np.argmax(np.abs(frontal_window))) if n > 0 else 0
    peak_amplitude = float(frontal_window[peak_idx]) if n > 0 else 0.0
    abs_peak_amplitude = abs(peak_amplitude)

    positive_excursion = float(np.max(frontal_window)) if n > 0 else 0.0
    negative_excursion = float(np.min(frontal_window)) if n > 0 else 0.0
    peak_to_peak_amplitude = positive_excursion - negative_excursion

    # Prominence relative to the two window edges (candidate boundaries are
    # where the signal crossed back toward baseline, so this approximates
    # scipy's prominence without needing the full surrounding trace).
    edge_level = float(np.mean([frontal_window[0], frontal_window[-1]])) if n > 0 else 0.0
    peak_prominence = abs_peak_amplitude - abs(edge_level - baseline_level)
    peak_prominence = max(peak_prominence, 0.0)

    if n > 1:
        rise_time_s = peak_idx * dt
        fall_time_s = (n - 1 - peak_idx) * dt
        slopes = np.diff(frontal_window) / dt
        max_slope = float(np.max(np.abs(slopes)))
        trapz_fn = getattr(np, "trapezoid", None) or np.trapz
        area_under_curve = float(trapz_fn(np.abs(frontal_window), dx=dt))
        rms = float(np.sqrt(np.mean(frontal_window ** 2)))
        signal_energy = float(np.sum(frontal_window ** 2))
    else:
        rise_time_s = 0.0
        fall_time_s = 0.0
        max_slope = 0.0
        area_under_curve = 0.0
        rms = abs_peak_amplitude
        signal_energy = frontal_window[0] ** 2 if n == 1 else 0.0

    agreement = check_af7_af8_agreement(
        af7_window, af8_window, agreement_min_correlation, agreement_max_amplitude_ratio
    )

    baseline_deviation = float(edge_level - baseline_level)

    return BlinkFeatures(
        peak_amplitude=peak_amplitude,
        abs_peak_amplitude=abs_peak_amplitude,
        peak_prominence=peak_prominence,
        positive_excursion=positive_excursion,
        negative_excursion=negative_excursion,
        peak_to_peak_amplitude=peak_to_peak_amplitude,
        duration_s=duration_s,
        rise_time_s=rise_time_s,
        fall_time_s=fall_time_s,
        max_slope=max_slope,
        area_under_curve=area_under_curve,
        rms=rms,
        signal_energy=signal_energy,
        af7_af8_correlation=agreement.correlation,
        af7_af8_amplitude_ratio=agreement.amplitude_ratio,
        baseline_deviation=baseline_deviation,
        time_since_previous_valid_blink_s=time_since_previous_valid_blink_s,
    )
