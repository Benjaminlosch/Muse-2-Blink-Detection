"""Tests for detection/adaptive_threshold.py — robust median/MAD threshold."""
from __future__ import annotations

import numpy as np

from bcihand.detection.adaptive_threshold import AdaptiveThreshold

FS = 256.0


def test_threshold_rises_above_noise_floor_after_warmup():
    thr = AdaptiveThreshold(FS, window_s=1.0, mad_multiplier=4.0, update_interval_samples=8)
    rng = np.random.default_rng(0)
    last = thr.threshold
    for _ in range(300):
        last = thr.update(abs(float(rng.normal(0, 5.0))))
    assert last > 0.0
    assert thr.noise_floor_median > 0.0


def test_in_candidate_samples_excluded_from_noise_floor():
    thr = AdaptiveThreshold(FS, window_s=1.0, mad_multiplier=4.0, update_interval_samples=8)
    for _ in range(100):
        thr.update(2.0)  # establish a small, stable noise floor
    baseline_threshold = thr.threshold

    # A large blink-magnitude run flagged in_candidate=True must not be
    # folded into the noise-floor estimate (else genuine blinks would
    # inflate their own detection threshold over time).
    for _ in range(50):
        thr.update(200.0, in_candidate=True)

    assert thr.threshold == baseline_threshold


def test_outlier_samples_without_in_candidate_flag_do_move_the_threshold():
    thr = AdaptiveThreshold(FS, window_s=1.0, mad_multiplier=4.0, update_interval_samples=8)
    for _ in range(100):
        thr.update(2.0)
    baseline_threshold = thr.threshold

    for _ in range(100):
        thr.update(50.0)  # sustained shift in "noise floor" without the flag

    assert thr.threshold > baseline_threshold


def test_seed_bulk_initializes_without_ramp_up():
    thr = AdaptiveThreshold(FS, window_s=1.0, mad_multiplier=4.0)
    samples = np.random.default_rng(1).normal(0, 5.0, 500)
    thr.seed(samples)
    assert thr.threshold > 0.0
    assert thr.noise_floor_median > 0.0


def test_threshold_never_below_min_threshold():
    thr = AdaptiveThreshold(FS, min_threshold=1e-3, update_interval_samples=8)
    for _ in range(100):
        thr.update(0.0)
    assert thr.threshold >= 1e-3
