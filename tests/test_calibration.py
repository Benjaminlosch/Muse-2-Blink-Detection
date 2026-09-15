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

from bcihand.acquisition.base import Sample
from bcihand.classification.state_machine import BlinkEventType
from bcihand.detection.calibration import CalibrationStats, TrialSegment, compute_calibration_stats
from bcihand.dsp.filters import CausalBlinkBandFilter
from bcihand.pipeline import BlinkPipeline
from bcihand.simulation.signal_generator import SignalSimulator, SimEvent
from bcihand.utils.config import apply_overrides, load_config

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


def _build_calibration_segments_tight_double_blink(seed: int = 7, gap_s: float = 0.10) -> list[TrialSegment]:
    """Like _build_calibration_segments, but with a tight inter-blink gap: a
    fast, deliberate double blink rides much further down the first pulse's
    still-decaying filter tail, so its second pulse's measured prominence
    can fall well below half of an isolated single blink's — the regime
    where derive_config_overrides' pre-existing single-blink-derived floor
    (which only assumes up to a ~75% relative reduction) stops being a safe
    upper bound. See the "second subtlety" in docs/CALIBRATION.md.
    """
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
            [SimEvent("double_blink", onset_s=1.0, duration_s=0.5, params={"amplitude_uv": 90, "gap_s": gap_s})],
            3.0,
        )
        for _ in range(3)
    ]
    return segments


def test_compute_calibration_stats_measures_double_blink_second_pulse_prominence():
    stats = compute_calibration_stats(_build_calibration_segments_tight_double_blink(), FS)
    assert stats.double_blink_second_pulse_prominence_median > 0.0
    # The second pulse rides the first pulse's still-decaying filter tail,
    # so its measured prominence must be meaningfully lower than an isolated
    # single blink's — this is the whole reason the ceiling in
    # derive_config_overrides exists.
    assert stats.double_blink_second_pulse_prominence_median < stats.intentional_blink_peak_median


def test_derive_config_overrides_never_exceeds_measured_double_blink_second_pulse_prominence():
    """Regression test: derive_config_overrides() must never derive a
    min_prominence_uv above what was actually measured for the calibration
    session's own double-blink second pulses — otherwise calibration can
    "pass" (3/3 double blinks detected during the wizard) while producing a
    threshold that then rejects live double blinks of similar amplitude.
    Found on real Muse 2 hardware: a successful 3/3+3/3 calibration run
    still rejected 15/16 live blink candidates afterwards
    (insufficient_prominence), including 5 deliberate double blinks.

    Uses a tight double-blink gap specifically because that is the regime
    that reproduces the bug (see _build_calibration_segments_tight_double_blink)
    — this also asserts against what the *old* (pre-fix) formula would have
    derived, so the test fails if the ceiling stops actually binding.
    """
    stats = compute_calibration_stats(_build_calibration_segments_tight_double_blink(), FS)
    overrides = stats.derive_config_overrides()
    new_min_prominence = overrides["candidate_detection"]["min_prominence_uv"]
    assert new_min_prominence <= stats.double_blink_second_pulse_prominence_median

    stats_without_second_pulse_data = compute_calibration_stats(_build_calibration_segments_tight_double_blink(), FS)
    stats_without_second_pulse_data.double_blink_second_pulse_prominence_median = 0.0
    old_min_prominence = stats_without_second_pulse_data.derive_config_overrides()["candidate_detection"]["min_prominence_uv"]
    assert new_min_prominence < old_min_prominence, (
        "This scenario should reproduce the bug (old formula overshoots the measured "
        "second-pulse prominence) — if it no longer does, this test isn't exercising the fix"
    )


def test_calibrated_pipeline_detects_a_fresh_double_blink_of_similar_amplitude():
    """End-to-end reproduction of the real-hardware bug report: calibrate
    from a set of tight DOUBLE_BLINK trials, derive overrides, then run a
    *new*, independently simulated double blink (different seed — not the
    exact calibration sample) of similar amplitude through the real
    pipeline and confirm it is actually recognized as DOUBLE_BLINK_CONFIRMED.
    """
    calib_segments = _build_calibration_segments_tight_double_blink(seed=7)
    stats = compute_calibration_stats(calib_segments, FS)
    overrides = stats.derive_config_overrides()

    config = apply_overrides(load_config(override_path=False), overrides)

    fresh_sim = SignalSimulator(fs_hz=FS, seed=99)  # different seed from calibration
    events = [SimEvent("double_blink", onset_s=2.0, duration_s=0.5, params={"amplitude_uv": 90, "gap_s": 0.10})]
    rec = fresh_sim.render(6.0, events)

    # BlinkPipeline.process_sample() filters raw samples itself, so feed it
    # the simulator's raw (unfiltered) output, not the pre-filtered arrays
    # used above for building calibration TrialSegments.
    samples = [
        Sample(timestamp_s=t, af7=rec.channels["AF7"][i], af8=rec.channels["AF8"][i], tp9=0.0, tp10=0.0)
        for i, t in enumerate(rec.timestamps)
    ]

    pipeline = BlinkPipeline(config, fs_hz=FS)
    results = [pipeline.process_sample(s) for s in samples]
    doubles = [
        r for r in results if r.state_event is not None and r.state_event.event_type == BlinkEventType.DOUBLE_BLINK_CONFIRMED
    ]
    assert len(doubles) == 1, (
        "A fresh double blink of similar amplitude to the calibration trials must still be "
        "recognized as DOUBLE_BLINK_CONFIRMED after calibration"
    )
