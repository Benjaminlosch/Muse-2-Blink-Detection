#!/usr/bin/env python
"""Offline analysis report (project brief section 18).

Runs a scenario (built-in simulated demo, or a previously recorded CSV from
scripts/record_data.py) through BlinkPipeline and reports precision/recall/
F1, and — the metric this project prioritizes — false activations per
minute, plus detection latency for genuine double blinks. See
src/bcihand/analysis/metrics.py for the matching/metric definitions.

Examples:
    python scripts/offline_analysis.py --scenario demo
    python scripts/offline_analysis.py --csv data/raw/session_2026-01-01.csv
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bcihand.acquisition.base import Sample  # noqa: E402
from bcihand.acquisition.simulated_source import SimulatedEEGSource  # noqa: E402
from bcihand.analysis.metrics import (  # noqa: E402
    DetectedEvent,
    GroundTruthEvent,
    compute_double_blink_metrics,
    confusion_counts_by_label,
    false_activation_breakdown,
)
from bcihand.classification.state_machine import BlinkEventType  # noqa: E402
from bcihand.pipeline import BlinkPipeline  # noqa: E402
from bcihand.simulation.signal_generator import build_demo_scenario  # noqa: E402
from bcihand.utils.config import load_config  # noqa: E402


def _intervals_from_label_column(rows: list[dict]) -> list[GroundTruthEvent]:
    """Run-length-encode a per-sample ground_truth_label CSV column into
    (start_s, end_s, label) intervals, skipping blank/REST labels."""
    intervals: list[GroundTruthEvent] = []
    current_label = None
    current_start = None
    prev_t = None
    for row in rows:
        t = float(row["timestamp"])
        label = row.get("ground_truth_label") or ""
        if label != current_label:
            if current_label and current_start is not None:
                intervals.append(GroundTruthEvent(current_start, prev_t, current_label))
            current_label = label
            current_start = t
        prev_t = t
    if current_label and current_start is not None:
        intervals.append(GroundTruthEvent(current_start, prev_t, current_label))
    return intervals


def run_demo_scenario(seed: int = 42):
    config = load_config()
    events = build_demo_scenario()
    duration = max(e.onset_s + e.duration_s for e in events) + 5.0
    source = SimulatedEEGSource(fs_hz=256.0, total_duration_s=duration, events=events, seed=seed)
    source.start()
    pipeline = BlinkPipeline(config, fs_hz=256.0)
    results = [pipeline.process_sample(s) for s in source.read_samples()]

    ground_truth = [GroundTruthEvent(s, e, label) for s, e, label in source.recording.ground_truth]
    detected = [
        DetectedEvent(r.state_event.timestamp_s, r.state_event.event_type.value, r.gate_decision.command.value)
        for r in results if r.state_event is not None
    ]
    return ground_truth, detected, duration


def run_csv(path: Path):
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise ValueError(f"{path} contains no rows")

    config = load_config()
    fs_hz = 256.0  # recorded CSVs don't currently store fs_hz; see docs/TESTING.md limitation note
    pipeline = BlinkPipeline(config, fs_hz=fs_hz)

    results = []
    for row in rows:
        sample = Sample(
            timestamp_s=float(row["timestamp"]),
            af7=float(row["af7"]), af8=float(row["af8"]),
            tp9=float(row["tp9"]), tp10=float(row["tp10"]),
            accel_x=float(row["accel_x"]) if row.get("accel_x") not in (None, "") else None,
            accel_y=float(row["accel_y"]) if row.get("accel_y") not in (None, "") else None,
            accel_z=float(row["accel_z"]) if row.get("accel_z") not in (None, "") else None,
        )
        results.append(pipeline.process_sample(sample))

    ground_truth = _intervals_from_label_column(rows)
    detected = [
        DetectedEvent(r.state_event.timestamp_s, r.state_event.event_type.value, r.gate_decision.command.value)
        for r in results if r.state_event is not None
    ]
    duration = float(rows[-1]["timestamp"]) - float(rows[0]["timestamp"])
    return ground_truth, detected, duration


def print_report(ground_truth, detected, duration_s: float) -> None:
    metrics = compute_double_blink_metrics(ground_truth, detected, total_duration_s=duration_s)

    print("=== Double-blink detection report ===")
    print(f"Recording duration:        {duration_s:.1f} s")
    print(f"True positives:            {metrics.true_positives}")
    print(f"False positives:           {metrics.false_positives}")
    print(f"False negatives:           {metrics.false_negatives}")
    print(f"Precision:                 {metrics.precision:.3f}")
    print(f"Recall:                    {metrics.recall:.3f}")
    print(f"F1:                        {metrics.f1:.3f}")
    print(f"False activations / min:   {metrics.false_activations_per_minute:.3f}  <-- priority metric")
    if metrics.mean_latency_ms is not None:
        print(f"Detection latency (ms):    mean={metrics.mean_latency_ms:.1f}  median={metrics.median_latency_ms:.1f}  p95={metrics.p95_latency_ms:.1f}")
    else:
        print("Detection latency (ms):    n/a (no matched detections)")

    breakdown = false_activation_breakdown(ground_truth, detected)
    if breakdown:
        print("\nFalse activations by concurrent artifact label:")
        for label, count in sorted(breakdown.items(), key=lambda kv: -kv[1]):
            print(f"  {label:24s} {count}")
    else:
        print("\nNo false activations.")

    all_counts = confusion_counts_by_label(ground_truth, detected)
    print("\nAll DOUBLE_BLINK_CONFIRMED events by concurrent label:")
    for label, count in sorted(all_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {label:24s} {count}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--scenario", choices=["demo"], help="run the built-in simulated scenario")
    group.add_argument("--csv", type=Path, help="analyze a previously recorded CSV (scripts/record_data.py output)")
    parser.add_argument("--seed", type=int, default=42, help="--scenario demo only")
    args = parser.parse_args()

    if args.csv:
        ground_truth, detected, duration = run_csv(args.csv)
    else:
        ground_truth, detected, duration = run_demo_scenario(seed=args.seed)
        print(
            "[note] --scenario demo measures latency against the simulator's "
            "declared event window, not a hardware-verified stimulus marker; "
            "expect it to be off by a sample or two (~1 period at 256 Hz). "
            "Real latency numbers require recorded Muse 2 data — WAITING FOR "
            "HARDWARE VERIFICATION.\n"
        )

    print_report(ground_truth, detected, duration)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
