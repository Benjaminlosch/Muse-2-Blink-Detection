"""Tests for detection/features.py cheap streaming feature extraction."""
from __future__ import annotations

import numpy as np

from bcihand.detection.features import extract_features

FS = 256.0


def _triangle_pulse(n: int, peak: float) -> np.ndarray:
    rise = np.linspace(0, peak, n // 2)
    fall = np.linspace(peak, 0, n - n // 2)
    return np.concatenate([rise, fall])


def test_basic_amplitude_and_timing_features():
    n = 40
    window = _triangle_pulse(n, peak=100.0)
    af7 = window.copy()
    af8 = window.copy()

    feats = extract_features(
        window, af7, af8, fs_hz=FS, baseline_level=0.0, time_since_previous_valid_blink_s=5.0
    )

    assert feats.peak_amplitude == np.max(window)
    assert feats.abs_peak_amplitude == np.max(window)
    assert feats.positive_excursion >= 0
    assert feats.negative_excursion <= feats.positive_excursion
    assert feats.duration_s == (n - 1) / FS
    assert feats.rise_time_s > 0
    assert feats.fall_time_s > 0
    assert feats.max_slope > 0
    assert feats.area_under_curve > 0
    assert feats.rms > 0
    assert feats.af7_af8_correlation > 0.99  # identical channels
    assert feats.time_since_previous_valid_blink_s == 5.0


def test_degenerate_ramp_has_zero_fall_time():
    # A pure monotonic ramp (like baseline drift crossing threshold near the
    # window's tail) has its peak at the last sample -> fall_time_s == 0,
    # which the classifier's "degenerate_rise_fall_shape" gate relies on.
    n = 20
    window = np.linspace(0, 100, n)
    feats = extract_features(window, window, window, fs_hz=FS, baseline_level=0.0, time_since_previous_valid_blink_s=1.0)
    assert feats.fall_time_s == 0.0
    assert feats.rise_time_s > 0.0


def test_single_sample_window_does_not_crash():
    window = np.array([50.0])
    feats = extract_features(window, window, window, fs_hz=FS, baseline_level=0.0, time_since_previous_valid_blink_s=1.0)
    assert feats.duration_s == 0.0
    assert feats.rise_time_s == 0.0
    assert feats.fall_time_s == 0.0
    assert feats.rms == 50.0


def test_asymmetric_channels_lower_agreement():
    n = 40
    af7 = _triangle_pulse(n, peak=100.0)
    af8 = np.zeros(n)  # completely different -> should show up as poor agreement
    feats = extract_features(af7, af7, af8, fs_hz=FS, baseline_level=0.0, time_since_previous_valid_blink_s=1.0)
    assert feats.af7_af8_correlation < 0.6 or feats.af7_af8_amplitude_ratio > 3.0


def test_peak_prominence_is_nonnegative():
    n = 40
    window = _triangle_pulse(n, peak=100.0)
    feats = extract_features(window, window, window, fs_hz=FS, baseline_level=200.0, time_since_previous_valid_blink_s=1.0)
    assert feats.peak_prominence >= 0.0
