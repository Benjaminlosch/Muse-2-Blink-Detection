#!/usr/bin/env python
"""Mode A entry point: Muse 2 (or simulator) -> PC -> BlinkPipeline -> ESP32.

This is the reference driver for the validated Mode A architecture (project
brief section 12): acquisition -> filtering -> detection -> classification ->
state machine -> confidence gate -> serial command, all running through the
exact same BlinkPipeline.process_sample() used by every automated test in
tests/test_end_to_end_simulation.py.

Examples:
    # Run the built-in "one of everything" simulated demo, print events, no ESP32:
    python scripts/run_pipeline.py --source simulate

    # Same, but also send OPEN/CLOSE/HOLD + heartbeats to a real ESP32 over serial:
    python scripts/run_pipeline.py --source simulate --serial-port COM3

    # Real Muse 2 (requires `pip install -e .[acquisition]`; WAITING FOR
    # HARDWARE VERIFICATION — see docs/MUSE2_SETUP.md):
    python scripts/run_pipeline.py --source muse2 --serial-port COM3
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bcihand.acquisition.simulated_source import SimulatedEEGSource  # noqa: E402
from bcihand.classification.command_mapper import Command  # noqa: E402
from bcihand.classification.state_machine import BlinkEventType  # noqa: E402
from bcihand.communication.serial_link import SerialLink  # noqa: E402
from bcihand.pipeline import BlinkPipeline  # noqa: E402
from bcihand.simulation.signal_generator import build_demo_scenario  # noqa: E402
from bcihand.utils.config import load_config  # noqa: E402


def build_source(args):
    if args.source == "simulate":
        events = build_demo_scenario() if args.scenario == "demo" else []
        duration = args.duration or (max((e.onset_s + e.duration_s for e in events), default=10.0) + 5.0)
        return SimulatedEEGSource(fs_hz=256.0, total_duration_s=duration, events=events, seed=args.seed, realtime=False)

    if args.source == "muse2":
        # WAITING FOR HARDWARE VERIFICATION — see docs/MUSE2_SETUP.md. This
        # path is written against BrainFlow's public API but has not been
        # exercised against a physical Muse 2 in this environment.
        from bcihand.acquisition.brainflow_source import BrainflowMuse2Source

        return BrainflowMuse2Source()

    raise ValueError(f"Unknown --source: {args.source}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", choices=["simulate", "muse2"], default="simulate")
    parser.add_argument("--scenario", choices=["demo", "empty"], default="demo", help="simulate-only: which built-in scenario to run")
    parser.add_argument("--duration", type=float, default=None, help="seconds; default covers the scenario plus 5s tail")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--serial-port", default=None, help="e.g. COM3; omit to run without an ESP32 attached")
    parser.add_argument("--baud-rate", type=int, default=115200)
    parser.add_argument("--config", default=None, help="path to a config YAML; default is config/default_config.yaml (+ calibration_active.yaml if present)")
    args = parser.parse_args()

    config = load_config(default_path=args.config) if args.config else load_config()

    link: SerialLink | None = None
    if args.serial_port:
        link = SerialLink.open_pyserial(args.serial_port, args.baud_rate, timeout_s=config.communication.timeout_s)
        print(f"[serial] opened {args.serial_port} @ {args.baud_rate} baud")

    def comm_ok_provider():
        return link.is_healthy() if link is not None else True

    source = build_source(args)
    source.start()
    fs_hz = source.sample_rate_hz
    pipeline = BlinkPipeline(config, fs_hz=fs_hz, comm_ok_provider=comm_ok_provider)

    last_heartbeat = time.monotonic()
    heartbeat_interval_s = config.communication.heartbeat_interval_s
    last_command_sent: Command | None = None
    n_samples = 0

    def process_batch(samples) -> None:
        nonlocal n_samples, last_command_sent
        for sample in samples:
            result = pipeline.process_sample(sample)
            n_samples += 1

            if result.state_event is not None:
                ev = result.state_event
                kind = "DOUBLE" if ev.event_type == BlinkEventType.DOUBLE_BLINK_CONFIRMED else "SINGLE"
                print(
                    f"t={sample.timestamp_s:8.3f}s  {kind:6s} blink  "
                    f"confidence={ev.confidence:.3f}  -> {result.gate_decision.command.value} "
                    f"({result.gate_decision.reason})"
                )

            if link is not None and result.gate_decision.command != last_command_sent:
                link.send_command(result.gate_decision.command.value)
                last_command_sent = result.gate_decision.command

    try:
        if args.source == "simulate":
            # The simulator hands back every sample in one shot (realtime=False
            # in build_source); process it as a single batch.
            process_batch(source.read_samples())
        else:
            # Real Muse 2 (or any other continuous EEGSource): poll until the
            # user stops it. This is the live acquisition loop for Mode A.
            while True:
                process_batch(source.read_samples())

                now = time.monotonic()
                if link is not None and now - last_heartbeat >= heartbeat_interval_s:
                    link.send_heartbeat()
                    link.poll_incoming()
                    last_heartbeat = now
                time.sleep(0.01)  # avoid a tight busy-loop between polls
    except KeyboardInterrupt:
        print("\n[run_pipeline] interrupted by user")
    finally:
        source.stop()
        if link is not None:
            link.send_command("HOLD")
            link.close()

    print(f"\nProcessed {n_samples} samples.")
    print(pipeline.latency.report_text())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
