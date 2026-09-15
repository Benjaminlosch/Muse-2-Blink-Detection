"""Tests for simulation/signal_generator.py — the synthetic Muse-2-like
signal generator used to exercise the pipeline without physical hardware."""
from __future__ import annotations

import numpy as np
import pytest

from bcihand.simulation.signal_generator import CHANNELS, SignalSimulator, SimEvent, build_demo_scenario


def test_render_produces_all_channels_at_correct_length():
    sim = SignalSimulator(fs_hz=256.0, seed=0)
    rec = sim.render(2.0, [])
    assert set(rec.channels.keys()) == set(CHANNELS)
    expected_n = int(2.0 * 256.0)
    for ch in CHANNELS:
        assert len(rec.channels[ch]) == expected_n
    assert len(rec.timestamps) == expected_n


def test_ground_truth_matches_scripted_events():
    sim = SignalSimulator(fs_hz=256.0, seed=0)
    events = [SimEvent("single_blink", onset_s=1.0, duration_s=0.2)]
    rec = sim.render(3.0, events)
    assert rec.ground_truth == [(1.0, 1.2, "single_blink")]


def test_unknown_event_label_raises():
    sim = SignalSimulator(fs_hz=256.0, seed=0)
    with pytest.raises(ValueError):
        sim.render(1.0, [SimEvent("not_a_real_event", onset_s=0.0, duration_s=0.1)])


def test_single_blink_produces_correlated_af7_af8_deflection():
    sim = SignalSimulator(fs_hz=256.0, seed=0)
    rec = sim.render(2.0, [SimEvent("single_blink", onset_s=0.5, duration_s=0.2, params={"amplitude_uv": 90})])
    start = int(0.5 * 256.0)
    end = start + int(0.2 * 256.0)
    af7_window = rec.channels["AF7"][start:end]
    af8_window = rec.channels["AF8"][start:end]
    assert np.max(np.abs(af7_window)) > 30.0
    assert np.corrcoef(af7_window, af8_window)[0, 1] > 0.8


def test_electrode_dropout_flatlines_target_channel_only():
    sim = SignalSimulator(fs_hz=256.0, seed=0)
    rec = sim.render(3.0, [SimEvent("electrode_dropout", onset_s=1.0, duration_s=1.0, params={"channel": "AF7"})])
    start = int(1.0 * 256.0)
    end = start + int(1.0 * 256.0)
    assert np.all(rec.channels["AF7"][start:end] == 0.0)
    assert np.std(rec.channels["AF8"][start:end]) > 0.0  # untouched channel still has noise


def test_head_motion_perturbs_accelerometer():
    sim = SignalSimulator(fs_hz=256.0, imu_fs_hz=52.0, seed=0)
    rec = sim.render(3.0, [SimEvent("head_motion", onset_s=1.0, duration_s=0.8, params={"accel_g": 0.3})])
    start = int(1.0 * 256.0)
    end = start + int(0.8 * 256.0)
    baseline_x_std = np.std(rec.accel["x"][:start])
    motion_x_std = np.std(rec.accel["x"][start:end])
    assert motion_x_std > baseline_x_std


def test_build_demo_scenario_covers_expected_event_types():
    events = build_demo_scenario()
    labels = {e.label for e in events}
    expected = {
        "single_blink", "double_blink", "slow_blink", "oversized_transient",
        "random_spike", "head_motion", "muscle_burst", "jaw_clench",
        "baseline_drift", "sixty_hz", "electrode_dropout", "single_channel_artifact",
    }
    assert expected <= labels


def test_seeded_simulator_is_deterministic():
    events = [SimEvent("single_blink", onset_s=1.0, duration_s=0.2)]
    rec1 = SignalSimulator(fs_hz=256.0, seed=123).render(2.0, events)
    rec2 = SignalSimulator(fs_hz=256.0, seed=123).render(2.0, events)
    np.testing.assert_array_equal(rec1.channels["AF7"], rec2.channels["AF7"])
