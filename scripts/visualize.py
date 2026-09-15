#!/usr/bin/env python
"""Debugging visualizer (project brief section 17): raw/filtered signal,
adaptive threshold, blink candidates, confidence, and the resolved command
timeline for a simulated (or, given a CSV, previously recorded) run.

This is PC-only debugging tooling, not part of the real-time control path.

Examples:
    python scripts/visualize.py --scenario demo --out data/processed/demo_debug.png
    python scripts/visualize.py --scenario demo --show   # also pop up an interactive window
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", choices=["demo", "empty"], default="demo")
    parser.add_argument("--duration", type=float, default=None)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default="data/processed/pipeline_debug_plot.png")
    parser.add_argument("--show", action="store_true", help="also open an interactive matplotlib window (requires a display)")
    args = parser.parse_args()

    if args.show:
        # bcihand.visualization.plots forces the headless "Agg" backend on
        # import for safety (it's used by automated tooling with no
        # display); switch to an interactive backend *before* importing it
        # if the caller actually wants a window.
        import matplotlib

        try:
            matplotlib.use("TkAgg", force=True)
        except Exception as exc:  # pragma: no cover - depends on local Tk/display availability
            print(f"[visualize] could not select an interactive backend ({exc}); continuing with --out only")
            args.show = False

    from bcihand.acquisition.simulated_source import SimulatedEEGSource
    from bcihand.pipeline import BlinkPipeline
    from bcihand.simulation.signal_generator import build_demo_scenario
    from bcihand.utils.config import load_config
    from bcihand.visualization.plots import build_debug_figure, save_debug_figure

    config = load_config()
    events = build_demo_scenario() if args.scenario == "demo" else []
    duration = args.duration or (max((e.onset_s + e.duration_s for e in events), default=10.0) + 5.0)

    source = SimulatedEEGSource(fs_hz=256.0, total_duration_s=duration, events=events, seed=args.seed)
    source.start()
    pipeline = BlinkPipeline(config, fs_hz=256.0)

    samples = source.read_samples()
    results = [pipeline.process_sample(s) for s in samples]
    af7 = [s.af7 for s in samples]
    af8 = [s.af8 for s in samples]

    fig = build_debug_figure(
        results, raw_af7=af7, raw_af8=af8, ground_truth=source.recording.ground_truth,
        high_confidence_threshold=config.confidence.high_confidence_threshold,
        medium_confidence_threshold=config.confidence.medium_confidence_threshold,
        title=f"BlinkPipeline debug view — scenario={args.scenario}",
    )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    save_debug_figure(fig, str(out_path))
    print(f"Saved debug plot to {out_path}")

    if args.show:
        import matplotlib.pyplot as plt

        plt.show()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
