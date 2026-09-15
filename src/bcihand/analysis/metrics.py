"""Offline analysis metrics (project brief section 18).

For a prosthetic-hand control system, FALSE ACTIVATIONS PER MINUTE is the
metric that actually matters — a classifier with high average accuracy but
occasional random hand activations is unacceptable (project brief section 8
/ section 28). Everything here is built around that priority: match
DOUBLE_BLINK_CONFIRMED events against ground-truth double-blink events,
report precision/recall/F1 for completeness, but treat the false-positive
count (as a per-minute rate) and detection latency as the headline numbers.

This module only knows about ground-truth interval labels and pipeline
output events — it doesn't run the pipeline itself. See
scripts/offline_analysis.py for the CLI that wires a recording (real or
simulated) through BlinkPipeline and into these functions.

Note on "true negatives" / "specificity": these are well-defined for
instance classification but not for a continuous event-detection stream
where "nothing happened" isn't a countable set of discrete trials. Per
project brief section 18 ("where applicable"), they are intentionally
omitted here in favor of the false-activations-per-minute rate, which is
the metric this project explicitly prioritizes.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class GroundTruthEvent:
    start_s: float
    end_s: float
    label: str  # e.g. "double_blink", "single_blink", "jaw_clench", ... (matches SimEvent labels)


@dataclass
class DetectedEvent:
    timestamp_s: float
    event_type: str  # "SINGLE_BLINK_CONFIRMED" | "DOUBLE_BLINK_CONFIRMED"
    command: str = "HOLD"  # the gate's resolved command at this event, if known


@dataclass
class MatchResult:
    true_positives: int
    false_positives: int
    false_negatives: int
    matched_latencies_s: list = field(default_factory=list)
    unmatched_detection_timestamps_s: list = field(default_factory=list)


def match_double_blink_events(
    ground_truth: list[GroundTruthEvent],
    detected: list[DetectedEvent],
    match_window_s: float = 2.0,
) -> MatchResult:
    """Greedy nearest-neighbor matching of DOUBLE_BLINK_CONFIRMED detections
    against ground-truth "double_blink" intervals.

    A detection matches a ground-truth interval if its timestamp falls
    within `match_window_s` of that interval's end (the point at which the
    second blink of a genuine double blink completes) and it is the closest
    remaining unmatched detection to that interval. Unmatched ground truth
    -> false negative; unmatched detections -> false positive (a real
    unwanted activation candidate).

    Label matching is case-insensitive: the simulator's own event labels are
    lowercase ("double_blink"), while utils/recorder.py's CSV convention
    (project brief section 16) is uppercase ("DOUBLE_BLINK") — this module
    is used against ground truth from both sources (scripts/offline_analysis.py
    --scenario demo vs. --csv), so it must not silently fail to match one of
    them.
    """
    gt_double = [g for g in ground_truth if g.label.upper() == "DOUBLE_BLINK"]
    det_double = [d for d in detected if d.event_type == "DOUBLE_BLINK_CONFIRMED"]

    matched_gt: set[int] = set()
    matched_det: set[int] = set()
    latencies: list[float] = []

    for gi, g in enumerate(gt_double):
        candidates = [
            (di, d) for di, d in enumerate(det_double)
            if di not in matched_det and abs(d.timestamp_s - g.end_s) <= match_window_s
        ]
        if not candidates:
            continue
        di, d = min(candidates, key=lambda pair: abs(pair[1].timestamp_s - g.end_s))
        matched_gt.add(gi)
        matched_det.add(di)
        latencies.append(d.timestamp_s - g.end_s)

    true_positives = len(matched_gt)
    false_negatives = len(gt_double) - true_positives
    unmatched = [d for di, d in enumerate(det_double) if di not in matched_det]
    false_positives = len(unmatched)

    return MatchResult(
        true_positives=true_positives,
        false_positives=false_positives,
        false_negatives=false_negatives,
        matched_latencies_s=latencies,
        unmatched_detection_timestamps_s=[d.timestamp_s for d in unmatched],
    )


@dataclass
class DoubleBlinkMetrics:
    true_positives: int
    false_positives: int
    false_negatives: int
    precision: float
    recall: float
    f1: float
    false_activations_per_minute: float
    mean_latency_ms: float | None
    median_latency_ms: float | None
    p95_latency_ms: float | None


def compute_double_blink_metrics(
    ground_truth: list[GroundTruthEvent],
    detected: list[DetectedEvent],
    total_duration_s: float,
    match_window_s: float = 2.0,
) -> DoubleBlinkMetrics:
    match = match_double_blink_events(ground_truth, detected, match_window_s)
    tp, fp, fn = match.true_positives, match.false_positives, match.false_negatives

    # Precision is undefined when the system made zero positive predictions
    # (tp+fp==0); by convention we report 1.0 in that case (zero predictions
    # means zero false alarms, which is the property this metric exists to
    # capture) rather than an arbitrary 0.0 that would look like a failure.
    precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 1.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    minutes = max(total_duration_s / 60.0, 1e-9)
    false_activations_per_minute = fp / minutes

    latencies_ms = [l * 1000.0 for l in match.matched_latencies_s]
    mean_latency_ms = float(np.mean(latencies_ms)) if latencies_ms else None
    median_latency_ms = float(np.median(latencies_ms)) if latencies_ms else None
    p95_latency_ms = float(np.percentile(latencies_ms, 95)) if latencies_ms else None

    return DoubleBlinkMetrics(
        true_positives=tp,
        false_positives=fp,
        false_negatives=fn,
        precision=precision,
        recall=recall,
        f1=f1,
        false_activations_per_minute=false_activations_per_minute,
        mean_latency_ms=mean_latency_ms,
        median_latency_ms=median_latency_ms,
        p95_latency_ms=p95_latency_ms,
    )


def label_at_time(ground_truth: list[GroundTruthEvent], t: float) -> str | None:
    """Which ground-truth interval (if any) contains timestamp t. Assumes
    non-overlapping intervals, as produced by SignalSimulator.render()."""
    for g in ground_truth:
        if g.start_s <= t <= g.end_s:
            return g.label
    return None


def false_activation_breakdown(
    ground_truth: list[GroundTruthEvent],
    detected: list[DetectedEvent],
    match_window_s: float = 2.0,
) -> dict[str, int]:
    """For every unmatched (false-positive) DOUBLE_BLINK_CONFIRMED detection,
    which ground-truth artifact label (if any) was active at that moment.
    Useful for diagnosing *which* artifact type is causing false activations
    rather than just knowing the count. Detections landing inside no
    ground-truth window are attributed to "unexplained"."""
    match = match_double_blink_events(ground_truth, detected, match_window_s)
    breakdown: dict[str, int] = {}
    for t in match.unmatched_detection_timestamps_s:
        label = label_at_time(ground_truth, t) or "unexplained"
        breakdown[label] = breakdown.get(label, 0) + 1
    return breakdown


def confusion_counts_by_label(
    ground_truth: list[GroundTruthEvent],
    detected: list[DetectedEvent],
    match_window_s: float = 2.0,
) -> dict[str, int]:
    """Count DOUBLE_BLINK_CONFIRMED detections by concurrent ground-truth
    label, for a full per-label activation breakdown (not just false
    positives) — useful for the offline analysis report's summary table.

    Matched true positives are always attributed to "double_blink" using the
    same tolerant match_double_blink_events() logic used for TP/FP counting
    — NOT via strict interval containment against the confirmation
    timestamp. A confirmation lands at the moment the second blink is
    classified, which can fall slightly outside a tightly-drawn ground-truth
    window (real detection latency, filter group delay, etc.) even for a
    genuine, correctly-matched double blink; using strict containment here
    would mislabel such matches as "unexplained" and make a true positive
    look like an unexplained false activation in the report.
    """
    match = match_double_blink_events(ground_truth, detected, match_window_s)
    counts: dict[str, int] = {}
    if match.true_positives:
        counts["double_blink"] = match.true_positives
    for t in match.unmatched_detection_timestamps_s:
        label = label_at_time(ground_truth, t) or "unexplained"
        counts[label] = counts.get(label, 0) + 1
    return counts
