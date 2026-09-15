#!/usr/bin/env python
"""Record a labeled session to CSV (project brief section 16).

Every row includes raw + filtered signal, the derived frontal signal,
signal quality, the pipeline's own blink-detector output, and (for
simulated runs) the ground-truth label — matching the schema in
utils/recorder.py so scripts/offline_analysis.py --csv can replay it later.

For --source muse2, ground truth can't be captured automatically (there's
no independent event marker), so every row is stamped with a single
--label you supply for the whole session (e.g. one recording per condition:
REST, SINGLE_BLINK, DOUBLE_BLINK, JAW, HEAD_LEFT, ...). Per-sample manual
relabeling during a live session is WAITING FOR HARDWARE VERIFICATION /
future tooling.

Examples:
    python scripts/record_data.py --source simulate --out data/raw/demo_session.csv
    python scripts/record_data.py --source muse2 --label DOUBLE_BLINK --duration 30 --out data/raw/session1.csv
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bcihand.acquisition.simulated_source import SimulatedEEGSource  # noqa: E402
from bcihand.pipeline import BlinkPipeline  # noqa: E402
from bcihand.simulation.signal_generator import build_demo_scenario  # noqa: E402
from bcihand.utils.config import load_config  # noqa: E402
from bcihand.utils.recorder import CSVRecorder, RecordRow  # noqa: E402


def label_for_timestamp(ground_truth, t: float, default: str = "REST") -> str:
    for start_s, end_s, label in ground_truth:
        if start_s <= t <= end_s:
            return label.upper()
    return default


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", choices=["simulate", "muse2"], default="simulate")
    parser.add_argument("--duration", type=float, default=None, help="seconds (required for --source muse2)")
    parser.add_argument("--label", default="REST", help="--source muse2 only: ground-truth label for the whole session")
    parser.add_argument("--seed", type=int, default=42, help="--source simulate only")
    parser.add_argument("--out", required=True, help="output CSV path")
    args = parser.parse_args()

    config = load_config()

    if args.source == "muse2":
        from bcihand.acquisition.brainflow_source import BrainflowMuse2Source

        if args.duration is None:
            parser.error("--duration is required for --source muse2")
        source = BrainflowMuse2Source()
        source.start()
        fs_hz = source.sample_rate_hz
        ground_truth = []
    else:
        events = build_demo_scenario()
        duration = args.duration or (max(e.onset_s + e.duration_s for e in events) + 5.0)
        source = SimulatedEEGSource(fs_hz=256.0, total_duration_s=duration, events=events, seed=args.seed)
        source.start()
        fs_hz = source.sample_rate_hz
        ground_truth = source.recording.ground_truth

    pipeline = BlinkPipeline(config, fs_hz=fs_hz)
    out_path = Path(args.out)

    n_rows = 0
    with CSVRecorder(out_path) as recorder:
        if args.source == "muse2":
            import time

            deadline = time.monotonic() + args.duration
            while time.monotonic() < deadline:
                for sample in source.read_samples():
                    result = pipeline.process_sample(sample)
                    recorder.write_row(RecordRow(
                        timestamp=sample.timestamp_s, af7=sample.af7, af8=sample.af8, tp9=sample.tp9, tp10=sample.tp10,
                        filtered_af7=result.filtered_af7, filtered_af8=result.filtered_af8,
                        derived_frontal_signal=result.frontal_signal,
                        accel_x=sample.accel_x, accel_y=sample.accel_y, accel_z=sample.accel_z,
                        signal_quality=result.signal_quality.quality,
                        blink_detector_output=result.classification.is_valid_blink if result.classification else "",
                        ground_truth_label=args.label.upper(),
                        predicted_label=(result.state_event.event_type.value if result.state_event else ""),
                        confidence=(result.classification.confidence if result.classification else None),
                        final_command=result.gate_decision.command.value,
                    ))
                    n_rows += 1
                time.sleep(0.01)
            source.stop()
        else:
            for sample in source.read_samples():
                result = pipeline.process_sample(sample)
                recorder.write_row(RecordRow(
                    timestamp=sample.timestamp_s, af7=sample.af7, af8=sample.af8, tp9=sample.tp9, tp10=sample.tp10,
                    filtered_af7=result.filtered_af7, filtered_af8=result.filtered_af8,
                    derived_frontal_signal=result.frontal_signal,
                    accel_x=sample.accel_x, accel_y=sample.accel_y, accel_z=sample.accel_z,
                    signal_quality=result.signal_quality.quality,
                    blink_detector_output=result.classification.is_valid_blink if result.classification else "",
                    ground_truth_label=label_for_timestamp(ground_truth, sample.timestamp_s),
                    predicted_label=(result.state_event.event_type.value if result.state_event else ""),
                    confidence=(result.classification.confidence if result.classification else None),
                    final_command=result.gate_decision.command.value,
                ))
                n_rows += 1

    print(f"Wrote {n_rows} rows to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
