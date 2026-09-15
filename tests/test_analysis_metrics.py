"""Tests for analysis/metrics.py offline evaluation metrics.

Per project brief section 18/28, false-activations-per-minute is the metric
this project prioritizes above raw accuracy — these tests focus there.
"""
from __future__ import annotations

import pytest

from bcihand.analysis.metrics import (
    DetectedEvent,
    GroundTruthEvent,
    compute_double_blink_metrics,
    confusion_counts_by_label,
    false_activation_breakdown,
    match_double_blink_events,
)


def test_perfect_match_yields_full_precision_and_recall():
    ground_truth = [
        GroundTruthEvent(5.0, 5.65, "double_blink"),
        GroundTruthEvent(39.0, 39.5, "double_blink"),
    ]
    detected = [
        DetectedEvent(5.7, "DOUBLE_BLINK_CONFIRMED", "OPEN"),
        DetectedEvent(39.6, "DOUBLE_BLINK_CONFIRMED", "CLOSE"),
    ]
    metrics = compute_double_blink_metrics(ground_truth, detected, total_duration_s=60.0)
    assert metrics.true_positives == 2
    assert metrics.false_positives == 0
    assert metrics.false_negatives == 0
    assert metrics.precision == 1.0
    assert metrics.recall == 1.0
    assert metrics.f1 == 1.0
    assert metrics.false_activations_per_minute == 0.0
    assert metrics.mean_latency_ms == pytest.approx(75.0, abs=1.0)


def test_false_positive_from_artifact_is_counted_and_hurts_precision():
    ground_truth = [
        GroundTruthEvent(5.0, 5.65, "double_blink"),
        GroundTruthEvent(20.0, 20.4, "jaw_clench"),
    ]
    detected = [
        DetectedEvent(5.7, "DOUBLE_BLINK_CONFIRMED", "OPEN"),
        DetectedEvent(20.2, "DOUBLE_BLINK_CONFIRMED", "CLOSE"),  # spurious, during jaw clench
    ]
    metrics = compute_double_blink_metrics(ground_truth, detected, total_duration_s=60.0)
    assert metrics.true_positives == 1
    assert metrics.false_positives == 1
    assert metrics.false_negatives == 0
    assert metrics.precision == 0.5
    assert metrics.recall == 1.0
    assert metrics.false_activations_per_minute == pytest.approx(1.0)  # 1 FP over 1 minute


def test_missed_double_blink_is_a_false_negative():
    ground_truth = [GroundTruthEvent(5.0, 5.65, "double_blink")]
    detected: list[DetectedEvent] = []
    metrics = compute_double_blink_metrics(ground_truth, detected, total_duration_s=60.0)
    assert metrics.true_positives == 0
    assert metrics.false_negatives == 1
    assert metrics.recall == 0.0
    assert metrics.precision == 1.0  # no detections at all -> no false positives either


def test_no_events_at_all_is_perfect_by_convention():
    metrics = compute_double_blink_metrics([], [], total_duration_s=60.0)
    assert metrics.true_positives == 0
    assert metrics.false_positives == 0
    assert metrics.false_negatives == 0
    assert metrics.precision == 1.0
    assert metrics.recall == 1.0


def test_detection_outside_match_window_does_not_match():
    ground_truth = [GroundTruthEvent(5.0, 5.65, "double_blink")]
    detected = [DetectedEvent(10.0, "DOUBLE_BLINK_CONFIRMED", "OPEN")]  # 4.35s away
    result = match_double_blink_events(ground_truth, detected, match_window_s=2.0)
    assert result.true_positives == 0
    assert result.false_negatives == 1
    assert result.false_positives == 1


def test_greedy_matching_picks_nearest_when_multiple_candidates():
    ground_truth = [GroundTruthEvent(5.0, 5.0, "double_blink")]
    detected = [
        DetectedEvent(6.5, "DOUBLE_BLINK_CONFIRMED", "OPEN"),
        DetectedEvent(5.2, "DOUBLE_BLINK_CONFIRMED", "OPEN"),
    ]
    result = match_double_blink_events(ground_truth, detected, match_window_s=2.0)
    assert result.true_positives == 1
    assert result.false_positives == 1  # the other detection is unmatched


def test_single_blink_confirmed_events_are_ignored_by_double_blink_matching():
    ground_truth = [GroundTruthEvent(5.0, 5.65, "double_blink")]
    detected = [DetectedEvent(5.7, "SINGLE_BLINK_CONFIRMED", "HOLD")]
    result = match_double_blink_events(ground_truth, detected, match_window_s=2.0)
    assert result.true_positives == 0
    assert result.false_negatives == 1
    assert result.false_positives == 0  # single-blink detections aren't counted as FPs here


def test_false_activation_breakdown_attributes_to_correct_artifact_label():
    ground_truth = [
        GroundTruthEvent(5.0, 5.65, "double_blink"),
        GroundTruthEvent(17.0, 17.8, "head_motion"),
    ]
    detected = [
        DetectedEvent(5.7, "DOUBLE_BLINK_CONFIRMED", "OPEN"),
        DetectedEvent(17.4, "DOUBLE_BLINK_CONFIRMED", "CLOSE"),
        DetectedEvent(50.0, "DOUBLE_BLINK_CONFIRMED", "OPEN"),  # no artifact nearby
    ]
    breakdown = false_activation_breakdown(ground_truth, detected)
    assert breakdown == {"head_motion": 1, "unexplained": 1}


def test_matching_is_case_insensitive_between_simulator_and_recorder_conventions():
    # The simulator's own event labels are lowercase ("double_blink"), while
    # utils/recorder.py's CSV convention (project brief section 16) is
    # uppercase ("DOUBLE_BLINK"). Ground truth loaded from either source must
    # match identically.
    ground_truth = [GroundTruthEvent(5.0, 5.65, "DOUBLE_BLINK")]
    detected = [DetectedEvent(5.7, "DOUBLE_BLINK_CONFIRMED", "OPEN")]
    metrics = compute_double_blink_metrics(ground_truth, detected, total_duration_s=60.0)
    assert metrics.true_positives == 1
    assert metrics.false_positives == 0


def test_confusion_counts_by_label_counts_all_double_blink_detections():
    ground_truth = [GroundTruthEvent(5.0, 5.65, "double_blink")]
    detected = [
        DetectedEvent(5.3, "DOUBLE_BLINK_CONFIRMED", "OPEN"),  # inside the [5.0, 5.65] window
        DetectedEvent(50.0, "DOUBLE_BLINK_CONFIRMED", "OPEN"),
    ]
    counts = confusion_counts_by_label(ground_truth, detected)
    assert counts == {"double_blink": 1, "unexplained": 1}
