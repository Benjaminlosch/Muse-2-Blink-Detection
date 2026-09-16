"""End-to-end safety/correctness test: the exact same code path used live
(scripts/run_pipeline.py) and here, per pipeline.py's module docstring.

This is the project's single most important automated test: it exercises
the full simulated "one of everything" scenario (build_demo_scenario) —
two genuine double blinks plus every artifact type the project brief calls
out for rejection (jaw clench, muscle burst, head motion, baseline drift,
60 Hz interference, electrode dropout, single-channel artifact, an
oversized transient, a random spike, and a slow blink) — through the real
BlinkPipeline, and asserts the core safety property from docs/SAFETY.md and
project brief section 28: the two genuine double blinks are recognized and
produce alternating OPEN/CLOSE, and NOTHING ELSE produces a non-HOLD
command. False activations per minute, not raw accuracy, is the metric that
matters for a device that moves a physical hand.
"""
from __future__ import annotations

from bcihand.acquisition.simulated_source import SimulatedEEGSource
from bcihand.classification.command_mapper import Command
from bcihand.classification.state_machine import BlinkEventType
from bcihand.pipeline import BlinkPipeline
from bcihand.simulation.signal_generator import build_demo_scenario
from bcihand.utils.config import ConfigNode, apply_overrides, load_config

FS = 256.0


def _run_demo_scenario(config: ConfigNode | None = None):
    if config is None:
        config = load_config(override_path=False)
    events = build_demo_scenario()
    total_duration_s = max(e.onset_s + e.duration_s for e in events) + 5.0

    source = SimulatedEEGSource(fs_hz=FS, total_duration_s=total_duration_s, events=events, seed=42)
    source.start()
    pipeline = BlinkPipeline(config, fs_hz=FS)

    results = [pipeline.process_sample(s) for s in source.read_samples()]
    return results, pipeline


def test_demo_scenario_produces_exactly_two_double_blinks_and_no_other_commands():
    results, _ = _run_demo_scenario()

    double_events = [
        r for r in results if r.state_event is not None and r.state_event.event_type == BlinkEventType.DOUBLE_BLINK_CONFIRMED
    ]
    assert len(double_events) == 2, (
        "build_demo_scenario() contains exactly two genuine double-blink events; "
        f"got {len(double_events)} DOUBLE_BLINK_CONFIRMED events instead"
    )

    non_hold_commands = [r.gate_decision.command for r in results if r.gate_decision.command != Command.HOLD]
    assert non_hold_commands == [Command.OPEN, Command.CLOSE], (
        "Every non-blink artifact in the demo scenario (jaw clench, muscle burst, "
        "head motion, baseline drift, 60Hz interference, electrode dropout, "
        "single-channel artifact, oversized transient, random spike, slow blink) "
        "must resolve to HOLD; only the two genuine double blinks may command "
        f"the hand. Got: {non_hold_commands}"
    )


def test_double_blink_timestamps_land_on_the_scripted_double_blink_events():
    results, _ = _run_demo_scenario()
    events = build_demo_scenario()
    scripted_double_onsets = [e.onset_s for e in events if e.label == "double_blink"]

    double_events = [
        r.state_event for r in results
        if r.state_event is not None and r.state_event.event_type == BlinkEventType.DOUBLE_BLINK_CONFIRMED
    ]
    assert len(double_events) == len(scripted_double_onsets) == 2

    for event, onset in zip(double_events, scripted_double_onsets):
        # The confirmed timestamp (second blink) should land within a couple
        # seconds of the scripted double-blink onset, not near some unrelated
        # artifact.
        assert abs(event.first_blink_timestamp_s - onset) < 2.0


def test_no_artifact_alone_reaches_double_blink_confirmation():
    # Even where an artifact produces a spurious SINGLE_BLINK_CONFIRMED (e.g.
    # a blink-like transient from head motion or 60Hz leakage), it must never
    # pair up into a DOUBLE_BLINK_CONFIRMED — the state machine only ever
    # forms a double blink from two independently-validated blink events
    # close together in time (project brief section 7).
    results, _ = _run_demo_scenario()
    events = build_demo_scenario()
    non_blink_labels = {
        "oversized_transient", "random_spike", "head_motion", "muscle_burst",
        "jaw_clench", "baseline_drift", "sixty_hz", "electrode_dropout",
        "single_channel_artifact",
    }
    non_blink_windows = [
        (e.onset_s - 1.0, e.onset_s + e.duration_s + 1.0) for e in events if e.label in non_blink_labels
    ]

    double_events = [
        r.state_event for r in results
        if r.state_event is not None and r.state_event.event_type == BlinkEventType.DOUBLE_BLINK_CONFIRMED
    ]
    for event in double_events:
        for start, end in non_blink_windows:
            assert not (start <= event.timestamp_s <= end)


def test_latency_stays_within_a_generous_real_time_budget():
    _, pipeline = _run_demo_scenario()
    summary = pipeline.latency.summary()
    assert "total_signal_to_command" in summary
    # Measured on a dev machine this lands well under 1ms; 20ms is a generous
    # regression guard, not a tuned real-time spec.
    assert summary["total_signal_to_command"]["p95_ms"] < 20.0
    assert summary["filtering"]["p95_ms"] < 5.0


def test_demo_scenario_holds_even_with_loosest_plausible_calibration_derived_agreement_gate():
    """Guards the "keep it rejecting coughs/bumps" requirement: the
    detection-channel/agreement-gate loosening introduced in
    detection/calibration.py's derive_config_overrides (to stop calibration
    from deriving thresholds that reject its own double blinks — see
    docs/CALIBRATION.md "Channel selection" and "second subtlety") is capped
    at af7_af8_min_correlation=0.2 / af7_af8_max_amplitude_ratio=6.0 in the
    worst case. Confirm that even at those loosest bounds, the full artifact
    scenario still resolves to HOLD for everything except the two genuine
    double blinks — the other hard gates (duration, prominence, signal
    quality, shape) still catch what the agreement gate no longer has to.
    """
    config = apply_overrides(
        load_config(override_path=False),
        {"spatial": {"af7_af8_min_correlation": 0.2, "af7_af8_max_amplitude_ratio": 6.0}},
    )
    results, _ = _run_demo_scenario(config)

    double_events = [
        r for r in results if r.state_event is not None and r.state_event.event_type == BlinkEventType.DOUBLE_BLINK_CONFIRMED
    ]
    assert len(double_events) == 2

    non_hold_commands = [r.gate_decision.command for r in results if r.gate_decision.command != Command.HOLD]
    assert non_hold_commands == [Command.OPEN, Command.CLOSE]


def test_pipeline_holds_when_communication_is_lost():
    config = load_config(override_path=False)
    events = build_demo_scenario()
    total_duration_s = max(e.onset_s + e.duration_s for e in events) + 5.0

    source = SimulatedEEGSource(fs_hz=FS, total_duration_s=total_duration_s, events=events, seed=42)
    source.start()
    pipeline = BlinkPipeline(config, fs_hz=FS, comm_ok_provider=lambda: False)

    results = [pipeline.process_sample(s) for s in source.read_samples()]
    assert all(r.gate_decision.command == Command.HOLD for r in results)
    assert any(r.gate_decision.reason == "communication_lost" for r in results if r.state_event is not None)
