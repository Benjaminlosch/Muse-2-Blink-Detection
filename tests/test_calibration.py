"""Tests for detection/calibration.py.

Uses the simulator + real causal filter chain to produce realistic filtered
trial segments (rather than hand-crafted arrays), so these tests exercise
the same candidate-detector-driven path real calibration data will take.

Regression coverage: compute_calibration_stats must select exactly the
expected number of instructed blinks per trial (one for SINGLE_BLINK, two
for DOUBLE_BLINK) even though the causal filter's own rebound lobe, and
occasional smaller same-sign ringing beyond the immediate rebound guard
window, can also produce additional width-valid candidates in the same
trial. Pooling those in naively previously corrupted the median amplitude
estimate (ringing candidates being smaller-but-more-numerous than the one
true blink peak) — see detection/calibration.py's _find_candidates_in_segment
and its per-trial top-N-by-amplitude selection.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import yaml

from bcihand.detection.calibration import CalibrationStats, TrialSegment, compute_calibration_stats
from bcihand.dsp.filters import CausalBlinkBandFilter
from bcihand.simulation.signal_generator import SignalSimulator, SimEvent

FS = 256.0


def _filtered_segment(sim: SignalSimulator, label: str, events: list[SimEvent], duration_s: float) -> TrialSegment:
    rec = sim.render(duration_s, events)
    af7 = CausalBlinkBandFilter(FS, 0.5, 20.0, notch_hz=60.0).process_block(rec.channels["AF7"])
    af8 = CausalBlinkBandFilter(FS, 0.5, 20.0, notch_hz=60.0).process_block(rec.channels["AF8"])
    frontal = (af7 + af8) / 2.0
    return TrialSegment(label=label, frontal=frontal, af7=af7, af8=af8)


def _build_calibration_segments(seed: int = 7) -> list[TrialSegment]:
    sim = SignalSimulator(fs_hz=FS, seed=seed)
    segments = [_filtered_segment(sim, "REST", [], 3.0) for _ in range(3)]
    segments += [
        _filtered_segment(
            sim, "SINGLE_BLINK",
            [SimEvent("single_blink", onset_s=1.0, duration_s=0.18, params={"amplitude_uv": 90})],
            2.5,
        )
        for _ in range(3)
    ]
    segments += [
        _filtered_segment(
            sim, "DOUBLE_BLINK",
            [SimEvent("double_blink", onset_s=1.0, duration_s=0.6, params={"amplitude_uv": 90, "gap_s": 0.25})],
            3.0,
        )
        for _ in range(3)
    ]
    return segments


def test_compute_calibration_stats_counts_one_blink_per_single_trial():
    stats = compute_calibration_stats(_build_calibration_segments(), FS)
    assert stats.n_single_trials == 3
    assert stats.n_single_candidates == 3  # exactly one per trial, ringing excluded
    # Median amplitude should reflect the true ~90uV instructed blink, not a
    # smaller ringing artifact.
    assert stats.intentional_blink_peak_median > 50.0


def test_compute_calibration_stats_counts_one_pair_per_double_trial():
    stats = compute_calibration_stats(_build_calibration_segments(), FS)
    assert stats.n_double_trials == 3
    assert stats.n_double_pairs == 3
    assert stats.double_blink_spacing_median_s > 0.0


def test_compute_calibration_stats_rest_baseline_is_near_zero():
    stats = compute_calibration_stats(_build_calibration_segments(), FS)
    assert stats.n_rest_trials == 3
    assert stats.baseline_median < 10.0  # filtered rest baseline is small


def test_derive_config_overrides_produces_sane_thresholds():
    stats = compute_calibration_stats(_build_calibration_segments(), FS)
    overrides = stats.derive_config_overrides()

    cd = overrides["candidate_detection"]
    assert cd["min_prominence_uv"] > 0.0
    assert 0.0 < cd["min_blink_width_s"] < cd["max_blink_width_s"]

    db = overrides["double_blink"]
    assert 0.08 <= db["min_interval_s"] < db["max_interval_s"]


def test_derive_config_overrides_omits_double_blink_section_without_data():
    stats = CalibrationStats(n_double_pairs=0)
    overrides = stats.derive_config_overrides()
    assert "double_blink" not in overrides


def test_save_writes_yaml_readable_by_config_loader(tmp_path: Path):
    stats = compute_calibration_stats(_build_calibration_segments(), FS)
    out_path = tmp_path / "calibration_active.yaml"
    stats.save(out_path)

    with open(out_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    assert "candidate_detection" in data
    assert "calibration_stats" in data
    assert data["calibration_stats"]["n_single_trials"] == 3


def test_median_mad_handles_empty_input():
    stats = compute_calibration_stats([], FS)
    assert stats.baseline_median == 0.0
    assert stats.n_rest_trials == 0
