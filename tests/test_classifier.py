"""Tests for classification/blink_classifier.py.

The classifier's contract (see its module docstring): any hard-gate failure
rejects outright (confidence forced to 0.0) regardless of how good the other
features look — a high score on other components must never compensate for a
failed gate like AF7/AF8 disagreement or electrode dropout.
"""
from __future__ import annotations

import numpy as np
import pytest

from bcihand.classification.blink_classifier import classify_candidate
from bcihand.detection.calibration import CalibrationStats
from bcihand.detection.candidate_detector import BlinkCandidate
from bcihand.detection.features import BlinkFeatures
from bcihand.detection.signal_quality import SignalQualityStatus

COMMON_KWARGS = dict(
    min_prominence_uv=20.0,
    min_blink_width_s=0.06,
    max_blink_width_s=0.40,
    af7_af8_min_correlation=0.6,
    af7_af8_max_amplitude_ratio=3.0,
    min_signal_quality=0.5,
)


def make_candidate(width_valid=True, rebound=False, peak_sign=1) -> BlinkCandidate:
    return BlinkCandidate(
        start_idx=0, end_idx=40, start_time_s=0.0, end_time_s=0.16,
        duration_s=0.16, frontal_window=np.linspace(0, 90, 41),
        af7_window=np.linspace(0, 90, 41), af8_window=np.linspace(0, 88, 41),
        threshold_at_detection=20.0, width_valid=width_valid, peak_sign=peak_sign,
        likely_filter_rebound=rebound,
    )


def make_features(duration_s=0.16, prominence=50.0, corr=0.95, ratio=1.05, rise=0.05, fall=0.05) -> BlinkFeatures:
    return BlinkFeatures(
        peak_amplitude=90, abs_peak_amplitude=90, peak_prominence=prominence,
        positive_excursion=90, negative_excursion=0, peak_to_peak_amplitude=90,
        duration_s=duration_s, rise_time_s=rise, fall_time_s=fall, max_slope=500,
        area_under_curve=10, rms=50, signal_energy=1000, af7_af8_correlation=corr,
        af7_af8_amplitude_ratio=ratio, baseline_deviation=0, time_since_previous_valid_blink_s=5.0,
    )


GOOD_QUALITY = SignalQualityStatus(quality=1.0, flatline=False, railed=False, excessive_noise=False)
CALIB = CalibrationStats(noise_floor_median=5.0, noise_floor_mad=2.0)


def test_clean_candidate_is_accepted_with_high_confidence():
    result = classify_candidate(make_candidate(), make_features(), GOOD_QUALITY, CALIB, **COMMON_KWARGS)
    assert result.is_valid_blink is True
    assert result.confidence == pytest.approx(0.9739, abs=1e-3)
    assert result.rejection_reasons == []


def test_invalid_width_hard_rejects():
    result = classify_candidate(make_candidate(width_valid=False), make_features(), GOOD_QUALITY, CALIB, **COMMON_KWARGS)
    assert result.is_valid_blink is False
    assert result.confidence == 0.0
    assert "duration_out_of_range" in result.rejection_reasons


def test_filter_rebound_hard_rejects():
    result = classify_candidate(make_candidate(rebound=True), make_features(), GOOD_QUALITY, CALIB, **COMMON_KWARGS)
    assert result.is_valid_blink is False
    assert "filter_rebound_bounce" in result.rejection_reasons


def test_flatline_hard_rejects_even_with_perfect_features():
    flat = SignalQualityStatus(quality=0.0, flatline=True, railed=False, excessive_noise=False)
    result = classify_candidate(make_candidate(), make_features(), flat, CALIB, **COMMON_KWARGS)
    assert result.is_valid_blink is False
    assert "electrode_dropout_flatline" in result.rejection_reasons


def test_railed_hard_rejects():
    railed = SignalQualityStatus(quality=0.0, flatline=False, railed=True, excessive_noise=False)
    result = classify_candidate(make_candidate(), make_features(), railed, CALIB, **COMMON_KWARGS)
    assert result.is_valid_blink is False
    assert "railed_or_oversized_transient" in result.rejection_reasons


def test_low_af7_af8_correlation_hard_rejects_regardless_of_amplitude():
    # A single-electrode spike can have huge amplitude/prominence but must
    # still be rejected on disagreement alone (this is the core defense
    # against single-electrode artifacts per project brief section 4).
    result = classify_candidate(
        make_candidate(), make_features(corr=0.1, prominence=500.0), GOOD_QUALITY, CALIB, **COMMON_KWARGS
    )
    assert result.is_valid_blink is False
    assert "af7_af8_disagreement_correlation" in result.rejection_reasons


def test_excessive_amplitude_ratio_hard_rejects():
    result = classify_candidate(
        make_candidate(), make_features(ratio=10.0), GOOD_QUALITY, CALIB, **COMMON_KWARGS
    )
    assert result.is_valid_blink is False
    assert "af7_af8_disagreement_amplitude_ratio" in result.rejection_reasons


def test_insufficient_prominence_hard_rejects():
    result = classify_candidate(
        make_candidate(), make_features(prominence=1.0), GOOD_QUALITY, CALIB, **COMMON_KWARGS
    )
    assert result.is_valid_blink is False
    assert "insufficient_prominence" in result.rejection_reasons


def test_degenerate_rise_or_fall_hard_rejects():
    result = classify_candidate(
        make_candidate(), make_features(fall=0.0), GOOD_QUALITY, CALIB, **COMMON_KWARGS
    )
    assert result.is_valid_blink is False
    assert "degenerate_rise_fall_shape" in result.rejection_reasons


def test_motion_veto_reduces_confidence_without_hard_rejecting():
    baseline = classify_candidate(make_candidate(), make_features(), GOOD_QUALITY, CALIB, **COMMON_KWARGS)
    with_veto = classify_candidate(
        make_candidate(), make_features(), GOOD_QUALITY, CALIB, **COMMON_KWARGS,
        motion_veto_active=True, motion_veto_confidence_penalty=0.5,
    )
    assert with_veto.is_valid_blink is True
    assert with_veto.confidence == pytest.approx(baseline.confidence * 0.5, rel=1e-6)


def test_multiple_simultaneous_failures_are_all_reported():
    flat = SignalQualityStatus(quality=0.0, flatline=True, railed=False, excessive_noise=False)
    result = classify_candidate(
        make_candidate(width_valid=False), make_features(corr=0.1), flat, CALIB, **COMMON_KWARGS
    )
    assert result.is_valid_blink is False
    assert len(result.rejection_reasons) >= 2
