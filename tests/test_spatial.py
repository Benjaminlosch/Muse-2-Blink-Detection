"""Tests for dsp/spatial.py: frontal_mean/difference and AF7/AF8 agreement."""
from __future__ import annotations

import numpy as np

from bcihand.dsp.spatial import check_af7_af8_agreement, frontal_difference, frontal_mean


def test_frontal_mean_and_difference_scalar():
    assert frontal_mean(10.0, 20.0) == 15.0
    assert frontal_difference(10.0, 20.0) == -10.0


def test_frontal_mean_and_difference_array():
    af7 = np.array([1.0, 2.0, 3.0])
    af8 = np.array([3.0, 2.0, 1.0])
    np.testing.assert_allclose(frontal_mean(af7, af8), [2.0, 2.0, 2.0])
    np.testing.assert_allclose(frontal_difference(af7, af8), [-2.0, 0.0, 2.0])


class TestAgreement:
    def test_correlated_equal_amplitude_agrees(self):
        t = np.linspace(0, np.pi, 50)
        af7 = np.sin(t) * 100
        af8 = np.sin(t) * 98  # nearly identical, bilateral blink-like
        result = check_af7_af8_agreement(af7, af8, min_correlation=0.6, max_amplitude_ratio=3.0)
        assert result.agrees is True
        assert result.correlation > 0.99

    def test_uncorrelated_signals_reject(self):
        rng = np.random.default_rng(0)
        af7 = rng.normal(0, 1, 100)
        af8 = rng.normal(0, 1, 100)  # independent noise, not bilateral
        result = check_af7_af8_agreement(af7, af8, min_correlation=0.6, max_amplitude_ratio=3.0)
        assert result.agrees is False

    def test_single_electrode_dominant_rejects_on_amplitude_ratio(self):
        t = np.linspace(0, np.pi, 50)
        af7 = np.sin(t) * 200  # single electrode spike, much bigger than AF8
        af8 = np.sin(t) * 5
        result = check_af7_af8_agreement(af7, af8, min_correlation=0.6, max_amplitude_ratio=3.0)
        assert result.agrees is False
        assert result.amplitude_ratio > 3.0

    def test_too_short_window_rejects(self):
        result = check_af7_af8_agreement(np.array([1.0]), np.array([1.0]))
        assert result.agrees is False

    def test_flat_channel_rejects(self):
        af7 = np.zeros(50)
        af8 = np.sin(np.linspace(0, np.pi, 50)) * 100
        result = check_af7_af8_agreement(af7, af8)
        assert result.agrees is False
        assert result.correlation == 0.0
