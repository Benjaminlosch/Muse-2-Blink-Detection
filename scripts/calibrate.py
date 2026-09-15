#!/usr/bin/env python
"""Guided calibration (project brief section 6 / docs/CALIBRATION.md).

Runs the REST / REST / REST / SINGLE / SINGLE / SINGLE / DOUBLE / DOUBLE /
DOUBLE trial sequence (counts and durations from config.calibration),
filters each trial through the same causal per-channel filter chain the
live pipeline uses, derives robust (median/MAD) statistics via
detection/calibration.py, and writes config/calibration_active.yaml —
which load_config() then automatically deep-merges over the defaults on
every subsequent run.

Examples:
    # Fully automated, no hardware needed (each trial is a fresh synthetic
    # rendering, useful for exercising/validating this script itself):
    python scripts/calibrate.py --source simulate

    # Real Muse 2 (WAITING FOR HARDWARE VERIFICATION; requires
    # `pip install -e .[acquisition]` — see docs/MUSE2_SETUP.md):
    python scripts/calibrate.py --source muse2
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bcihand.classification.blink_classifier import classify_candidate  # noqa: E402
from bcihand.detection.calibration import CalibrationStats, TrialSegment, compute_calibration_stats  # noqa: E402
from bcihand.detection.candidate_detector import CandidateDetector  # noqa: E402
from bcihand.detection.signal_quality import SignalQualityStatus  # noqa: E402
from bcihand.detection.features import extract_features  # noqa: E402
from bcihand.dsp.filters import CausalBlinkBandFilter  # noqa: E402
from bcihand.utils.config import apply_overrides, load_config  # noqa: E402

_GOOD_QUALITY = SignalQualityStatus(quality=1.0, flatline=False, railed=False, excessive_noise=False)
_EXPECTED_VALID_BLINKS = {"SINGLE_BLINK": 1, "DOUBLE_BLINK": 2}


def validate_calibration_against_trials(segments: list[TrialSegment], config, fs_hz: float) -> list[str]:
    """Replay each SINGLE_BLINK/DOUBLE_BLINK calibration trial through the
    FULL classifier (not just the raw candidate detector) using the
    calibration-derived thresholds, and flag any trial where the classifier
    accepted fewer valid blinks than the trial's own label implies. This
    catches the exact failure mode found while building this script: an
    overly tight min_prominence_uv/min_blink_width_s derived from a
    low-variance calibration session can silently reject one of a double
    blink's two pulses (see detection/calibration.py derive_config_overrides
    docstring) — better to warn the operator now than discover it live.
    """
    cd_cfg = config.candidate_detection
    spatial_cfg = config.spatial
    calibration_for_scoring = config.get("calibration_stats", None) or CalibrationStats()
    warnings: list[str] = []

    for i, seg in enumerate(segments):
        expected = _EXPECTED_VALID_BLINKS.get(seg.label)
        if expected is None:
            continue

        detector = CandidateDetector(
            fs_hz=fs_hz, min_blink_width_s=cd_cfg.min_blink_width_s, max_blink_width_s=cd_cfg.max_blink_width_s,
            refractory_after_candidate_s=cd_cfg.refractory_after_candidate_s,
            threshold_mad_multiplier=cd_cfg.threshold_mad_multiplier,
            rebound_guard_s=cd_cfg.get("rebound_guard_s", 0.30), rebound_refractory_s=cd_cfg.get("rebound_refractory_s", 0.02),
        )
        n_valid = 0
        for f, a7, a8 in zip(seg.frontal, seg.af7, seg.af8):
            candidate = detector.process_sample(f, a7, a8)
            if candidate is None:
                continue
            features = extract_features(
                candidate.frontal_window, candidate.af7_window, candidate.af8_window, fs_hz,
                baseline_level=detector.threshold.noise_floor_median, time_since_previous_valid_blink_s=999.0,
                agreement_min_correlation=spatial_cfg.af7_af8_min_correlation,
                agreement_max_amplitude_ratio=spatial_cfg.af7_af8_max_amplitude_ratio,
            )
            result = classify_candidate(
                candidate, features, _GOOD_QUALITY, calibration_for_scoring,
                min_prominence_uv=cd_cfg.min_prominence_uv, min_blink_width_s=cd_cfg.min_blink_width_s,
                max_blink_width_s=cd_cfg.max_blink_width_s, af7_af8_min_correlation=spatial_cfg.af7_af8_min_correlation,
                af7_af8_max_amplitude_ratio=spatial_cfg.af7_af8_max_amplitude_ratio,
                min_signal_quality=config.confidence.min_signal_quality,
            )
            if result.is_valid_blink:
                n_valid += 1

        if n_valid < expected:
            warnings.append(
                f"trial {i} ({seg.label}): expected {expected} valid blink(s) under the derived "
                f"thresholds, classifier only accepted {n_valid}. Thresholds may be too tight."
            )
    return warnings


def _filter_channel(fs_hz, dsp_cfg, raw_values):
    chain = CausalBlinkBandFilter(
        fs_hz, dsp_cfg.highpass_hz, dsp_cfg.lowpass_hz, dsp_cfg.filter_order,
        dsp_cfg.notch_hz if dsp_cfg.notch_enabled else None, dsp_cfg.notch_quality_factor,
        dsp_cfg.baseline_tracker_time_constant_s,
    )
    import numpy as np

    return chain.process_block(np.asarray(raw_values, dtype=np.float64))


def collect_simulated_trial(label: str, duration_s: float, fs_hz: float, seed: int) -> TrialSegment:
    from bcihand.simulation.signal_generator import SignalSimulator, SimEvent

    sim = SignalSimulator(fs_hz=fs_hz, seed=seed)
    events = []
    if label == "SINGLE_BLINK":
        events = [SimEvent("single_blink", onset_s=duration_s / 2, duration_s=0.18, params={"amplitude_uv": 90})]
    elif label == "DOUBLE_BLINK":
        events = [SimEvent("double_blink", onset_s=duration_s / 2, duration_s=0.58, params={"amplitude_uv": 90, "gap_s": 0.22})]
    rec = sim.render(duration_s, events)
    return rec, label


def collect_live_trial(source, label: str, duration_s: float) -> tuple[list, list, list]:
    af7, af8, tp9, tp10 = [], [], [], []
    deadline = time.monotonic() + duration_s
    while time.monotonic() < deadline:
        for s in source.read_samples():
            af7.append(s.af7)
            af8.append(s.af8)
            tp9.append(s.tp9)
            tp10.append(s.tp10)
        time.sleep(0.01)
    return af7, af8, tp9, tp10


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", choices=["simulate", "muse2"], default="simulate")
    parser.add_argument("--seed", type=int, default=0, help="--source simulate only")
    parser.add_argument("--output", default=None, help="override config.calibration.output_path")
    args = parser.parse_args()

    config = load_config()
    cal_cfg = config.calibration
    dsp_cfg = config.dsp
    fs_hz = config.acquisition.fallback_sample_rate_hz

    plan: list[tuple[str, float]] = (
        [("REST", cal_cfg.rest_trial_duration_s)] * cal_cfg.rest_trials
        + [("SINGLE_BLINK", 2.5)] * cal_cfg.single_blink_trials
        + [("DOUBLE_BLINK", 3.0)] * cal_cfg.double_blink_trials
    )

    segments: list[TrialSegment] = []

    if args.source == "muse2":
        from bcihand.acquisition.brainflow_source import BrainflowMuse2Source

        source = BrainflowMuse2Source()
        source.start()
        fs_hz = source.sample_rate_hz
        print(f"Connected. Sample rate: {fs_hz} Hz.\n")

        try:
            for i, (label, duration_s) in enumerate(plan):
                input(f"[{i + 1}/{len(plan)}] Get ready for {label} ({duration_s:.1f}s). Press Enter to start...")
                if label != "REST":
                    print(f"  -> {label.replace('_', ' ')} NOW")
                af7, af8, tp9, tp10 = collect_live_trial(source, label, duration_s)
                filtered_af7 = _filter_channel(fs_hz, dsp_cfg, af7)
                filtered_af8 = _filter_channel(fs_hz, dsp_cfg, af8)
                frontal = (filtered_af7 + filtered_af8) / 2.0
                segments.append(TrialSegment(label=label, frontal=frontal, af7=filtered_af7, af8=filtered_af8))
                time.sleep(cal_cfg.inter_trial_pause_s)
        finally:
            source.stop()
    else:
        print("Running fully automated simulated calibration (no hardware).")
        for i, (label, duration_s) in enumerate(plan):
            rec, label = collect_simulated_trial(label, duration_s, fs_hz, seed=args.seed + i)
            filtered_af7 = _filter_channel(fs_hz, dsp_cfg, rec.channels["AF7"])
            filtered_af8 = _filter_channel(fs_hz, dsp_cfg, rec.channels["AF8"])
            frontal = (filtered_af7 + filtered_af8) / 2.0
            segments.append(TrialSegment(label=label, frontal=frontal, af7=filtered_af7, af8=filtered_af8))

    stats = compute_calibration_stats(segments, fs_hz)

    print("\n=== Calibration results ===")
    print(f"Rest trials:              {stats.n_rest_trials}  (baseline_median={stats.baseline_median:.2f}, baseline_mad={stats.baseline_mad:.2f})")
    print(f"Single-blink trials:      {stats.n_single_trials}  (n_candidates_found={stats.n_single_candidates}, peak_median={stats.intentional_blink_peak_median:.2f} uV)")
    print(f"Double-blink trials:      {stats.n_double_trials}  (n_pairs_found={stats.n_double_pairs}, spacing_median={stats.double_blink_spacing_median_s:.3f} s)")

    if stats.n_single_candidates < stats.n_single_trials or stats.n_double_pairs < stats.n_double_trials:
        print(
            "\n[warning] Not every trial produced a detected blink candidate. "
            "Thresholds derived from this run may be unreliable — consider "
            "recalibrating with clearer, more deliberate blinks."
        )

    overrides = stats.derive_config_overrides()
    merged_config = apply_overrides(config, overrides)
    self_check_warnings = validate_calibration_against_trials(segments, merged_config, fs_hz)
    if self_check_warnings:
        print(
            "\n[warning] Self-check: replaying the calibration trials themselves through the "
            "derived thresholds did not classify every expected blink as valid:"
        )
        for w in self_check_warnings:
            print(f"  - {w}")
        print(
            "  Saving anyway (HOLD is always the fail-safe state), but consider recalibrating "
            "with more/clearer trials, or manually widening the derived thresholds in "
            f"{cal_cfg.output_path} before trusting this for physical hand control."
        )
    else:
        print("\nSelf-check passed: every calibration trial's expected blink(s) classify as valid under the derived thresholds.")

    output_path = Path(args.output or cal_cfg.output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    stats.save(output_path)
    print(f"\nSaved calibration overrides to {output_path}")
    print("These take effect automatically on the next load_config() call (e.g. scripts/run_pipeline.py).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
