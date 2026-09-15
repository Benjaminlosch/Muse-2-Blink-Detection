"""Calibration: turn a short guided recording session into per-user thresholds.

We deliberately do NOT ship one universal fixed amplitude threshold. Instead
we run a short guided sequence (REST / REST / REST / SINGLE / SINGLE / SINGLE
/ DOUBLE / DOUBLE / DOUBLE, per docs/CALIBRATION.md) and derive robust
(median / MAD) statistics from it.

Honest limitation (see docs/SIGNAL_PIPELINE.md "Known limitations"):
physiologically, a deliberate single blink and a spontaneous single blink
often look very similar in amplitude/shape. Calibration cannot manufacture a
separation that isn't there. That is *why* this system's primary control
signal is the double blink (an unusual, low-base-rate temporal pattern)
rather than the single blink — see config/default_config.yaml
`communication.command_mapping`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import yaml

from .adaptive_threshold import MAD_TO_SIGMA
from .candidate_detector import CandidateDetector, BlinkCandidate
from .features import extract_features


def _median_mad(values: list[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 0.0
    arr = np.asarray(values, dtype=np.float64)
    med = float(np.median(arr))
    mad = float(np.median(np.abs(arr - med)))
    return med, mad


@dataclass
class CalibrationStats:
    baseline_median: float = 0.0
    baseline_mad: float = 0.0
    noise_floor_median: float = 0.0
    noise_floor_mad: float = 0.0

    normal_blink_peak_median: float = 0.0
    normal_blink_peak_mad: float = 0.0
    n_rest_candidates: int = 0

    intentional_blink_peak_median: float = 0.0
    intentional_blink_peak_mad: float = 0.0
    intentional_duration_median_s: float = 0.0
    intentional_duration_mad_s: float = 0.0
    intentional_rise_time_median_s: float = 0.0
    intentional_fall_time_median_s: float = 0.0
    n_single_candidates: int = 0

    double_blink_spacing_median_s: float = 0.0
    double_blink_spacing_mad_s: float = 0.0
    n_double_pairs: int = 0

    # The *actual* classifier-equivalent prominence (extract_features'
    # peak_prominence, not a raw peak-amplitude proxy) of each DOUBLE_BLINK
    # trial's second pulse — directly measured, not guessed. Used as a hard
    # ceiling on the derived min_prominence_uv so calibration can never
    # produce a threshold that would have rejected the very double blinks it
    # just verified. 0.0 (the default) means "no double-blink trial data",
    # e.g. a calibration saved before this field existed — see
    # derive_config_overrides.
    double_blink_second_pulse_prominence_median: float = 0.0
    double_blink_second_pulse_prominence_mad: float = 0.0
    # Same idea for duration: the second pulse's candidate window is often
    # shorter than an isolated blink's (it starts already-elevated above
    # baseline, so the candidate detector's threshold-crossing boundary
    # falls later relative to the true blink onset) — measured directly so
    # min_blink_width_s can't reject it either.
    double_blink_second_pulse_duration_median_s: float = 0.0
    double_blink_second_pulse_duration_mad_s: float = 0.0

    n_rest_trials: int = 0
    n_single_trials: int = 0
    n_double_trials: int = 0

    def derive_config_overrides(self, prominence_margin_sigma: float = 1.5,
                                 interval_margin_s: float = 0.15,
                                 min_relative_prominence_spread: float = 0.5,
                                 min_duration_spread_s: float = 0.02,
                                 second_pulse_margin_sigma: float = 1.0,
                                 min_relative_second_pulse_spread: float = 0.3) -> dict:
        """Turn measured stats into a config-override dict compatible with
        config/default_config.yaml's structure (deep-merged as
        config/calibration_active.yaml).

        A short calibration session (a handful of trials, or trials that
        happen to be unusually consistent — e.g. our own simulator's
        deterministic pulses) can produce a measured MAD of ~0. Without a
        floor, that collapses min_prominence_uv to essentially the exact
        calibration-trial amplitude and min_blink_width_s to its exact
        duration, rejecting perfectly genuine blinks that are only slightly
        weaker/shorter than the calibration sample. `min_relative_prominence_spread`
        and `min_duration_spread_s` are floors on the spread used, applied
        symmetrically with the existing max_blink_width_s floor below.

        min_relative_prominence_spread defaults to a generous 0.5 (50% of the
        calibrated single-blink median) rather than a tight value, because
        the SINGLE_BLINK calibration trials are isolated blinks, but a
        double blink's *second* pulse rides on the first pulse's still-decaying
        causal-filter tail and its measured peak_prominence (which subtracts
        deviation from baseline — see detection/features.py) is legitimately
        lower than an isolated blink's, often by 40-50%. This was found by
        direct observation: with a tighter floor, scripts/calibrate.py
        --source simulate followed by scripts/run_pipeline.py silently
        turned both scripted demo double blinks into unmatched SINGLE
        blinks (the second pulse's prominence fell just under
        min_prominence_uv). See also the calibrate.py post-calibration
        self-check, which replays the calibration trials themselves through
        the full classifier and warns if a derived threshold would reject
        one of its own double-blink second pulses.

        The above is still only a *guess* at how much weaker a second pulse
        will be, extrapolated from single-blink amplitude. When DOUBLE_BLINK
        trial data is available, double_blink_second_pulse_prominence_median
        is the real measured peak_prominence (extract_features, the exact
        feature the live classifier gates on) of those trials' second
        pulses — used below as a hard ceiling so the derived threshold can
        never exceed what was actually measured, i.e. calibration can never
        reject the very double blinks it just verified.
        """
        prominence_spread = max(
            self.intentional_blink_peak_mad * MAD_TO_SIGMA,
            min_relative_prominence_spread * self.intentional_blink_peak_median,
        )
        min_prominence = max(
            self.intentional_blink_peak_median - prominence_margin_sigma * prominence_spread,
            self.noise_floor_median + 2 * MAD_TO_SIGMA * self.noise_floor_mad,
            1e-6,
        )

        if self.n_double_pairs > 0 and self.double_blink_second_pulse_prominence_median > 0:
            second_pulse_spread = max(
                self.double_blink_second_pulse_prominence_mad * MAD_TO_SIGMA,
                min_relative_second_pulse_spread * self.double_blink_second_pulse_prominence_median,
            )
            # Deliberately NOT re-clamped to the noise-floor lower bound
            # above: these second pulses were *already* real, width-valid,
            # non-artifact candidates during calibration (the adaptive
            # candidate detector's own noise-floor-based threshold already
            # passed them before classify_candidate's min_prominence_uv gate
            # ever saw them), so re-imposing that same noise-floor bound
            # here would just recreate the bug this ceiling exists to fix —
            # a session with a noisier baseline could derive a
            # min_prominence_uv *above* what its own verified double blinks
            # actually measured.
            second_pulse_ceiling = max(
                self.double_blink_second_pulse_prominence_median - second_pulse_margin_sigma * second_pulse_spread,
                1e-6,
            )
            min_prominence = min(min_prominence, second_pulse_ceiling)

        duration_spread = max(self.intentional_duration_mad_s, min_duration_spread_s)
        min_width = max(self.intentional_duration_median_s - 3 * duration_spread, 0.02)
        max_width = self.intentional_duration_median_s + 4 * duration_spread + 0.1

        if self.n_double_pairs > 0 and self.double_blink_second_pulse_duration_median_s > 0:
            # Same reasoning as the prominence ceiling above: a fast double
            # blink's second-pulse candidate window can be genuinely shorter
            # than an isolated blink's (it starts already-elevated, so the
            # threshold-crossing "start" falls later) — never derive a
            # min_blink_width_s above what was actually measured.
            second_pulse_duration_spread = max(self.double_blink_second_pulse_duration_mad_s, min_duration_spread_s)
            min_width = min(min_width, max(
                self.double_blink_second_pulse_duration_median_s - 2 * second_pulse_duration_spread, 0.02,
            ))

        if self.n_double_pairs > 0:
            spacing = self.double_blink_spacing_median_s
            spacing_spread = max(self.double_blink_spacing_mad_s * MAD_TO_SIGMA, 0.05)
            min_interval = max(spacing - spacing_spread - interval_margin_s, 0.08)
            max_interval = spacing + spacing_spread + interval_margin_s
        else:
            min_interval, max_interval = None, None

        overrides: dict = {
            "candidate_detection": {
                "min_prominence_uv": round(min_prominence, 4),
                "min_blink_width_s": round(min_width, 4),
                "max_blink_width_s": round(max_width, 4),
            },
            "calibration_stats": self.__dict__,
        }
        if min_interval is not None:
            overrides["double_blink"] = {
                "min_interval_s": round(min_interval, 4),
                "max_interval_s": round(max_interval, 4),
            }
        return overrides

    def save(self, path: Path | str) -> None:
        overrides = self.derive_config_overrides()
        with open(path, "w", encoding="utf-8") as f:
            yaml.safe_dump(overrides, f, sort_keys=False)


@dataclass
class TrialSegment:
    label: str  # "REST", "SINGLE_BLINK", "DOUBLE_BLINK"
    frontal: np.ndarray
    af7: np.ndarray
    af8: np.ndarray


def _find_candidates_in_segment(seg: TrialSegment, fs_hz: float) -> list[BlinkCandidate]:
    """Width-valid, non-rebound candidates within one trial segment.

    Filter-rebound lobes are excluded here for the same reason the live
    classifier hard-rejects them (see classification/blink_classifier.py):
    they are the causal bandpass filter's own opposite-sign overshoot
    following a real blink, not a second physiological event, and must never
    be pooled into calibration statistics as if they were.
    """
    detector = CandidateDetector(fs_hz=fs_hz, threshold_window_s=max(len(seg.frontal) / fs_hz, 1.0))
    out = []
    for f, a7, a8 in zip(seg.frontal, seg.af7, seg.af8):
        cand = detector.process_sample(f, a7, a8)
        if cand is not None and cand.width_valid and not cand.likely_filter_rebound:
            out.append(cand)
    return out


def _peak_uv(c: BlinkCandidate) -> float:
    return float(np.max(np.abs(c.frontal_window)))


def compute_calibration_stats(segments: list[TrialSegment], fs_hz: float) -> CalibrationStats:
    """segments: already-filtered trial recordings in calibration-sequence order."""
    stats = CalibrationStats()

    rest_values: list[float] = []
    for seg in segments:
        if seg.label == "REST":
            rest_values.extend(np.abs(seg.frontal).tolist())
            stats.n_rest_trials += 1
        elif seg.label == "SINGLE_BLINK":
            stats.n_single_trials += 1
        elif seg.label == "DOUBLE_BLINK":
            stats.n_double_trials += 1

    stats.baseline_median, stats.baseline_mad = _median_mad(rest_values)
    stats.noise_floor_median, stats.noise_floor_mad = stats.baseline_median, stats.baseline_mad

    normal_peaks: list[float] = []
    intentional_peaks: list[float] = []
    intentional_durations: list[float] = []
    intentional_rise_times: list[float] = []
    intentional_fall_times: list[float] = []
    double_spacings: list[float] = []
    double_second_pulse_prominences: list[float] = []
    double_second_pulse_durations: list[float] = []

    for seg in segments:
        candidates = _find_candidates_in_segment(seg, fs_hz)
        if seg.label == "REST":
            for c in candidates:
                normal_peaks.append(float(np.max(np.abs(c.frontal_window))))
        elif seg.label == "SINGLE_BLINK":
            # A SINGLE_BLINK trial is, by the calibration protocol, exactly
            # one instructed blink — take only the largest-amplitude
            # candidate so any residual small same-sign filter ringing that
            # slips past the rebound guard (see docs/SIGNAL_PIPELINE.md
            # "Filter rebound rejection") cannot masquerade as extra blinks
            # and drag the median amplitude/duration estimate down.
            if candidates:
                c = max(candidates, key=_peak_uv)
                intentional_peaks.append(_peak_uv(c))
                intentional_durations.append(c.duration_s)
                peak_idx = int(np.argmax(np.abs(c.frontal_window)))
                intentional_rise_times.append(peak_idx / fs_hz)
                intentional_fall_times.append((len(c.frontal_window) - 1 - peak_idx) / fs_hz)
        elif seg.label == "DOUBLE_BLINK":
            # Likewise, a DOUBLE_BLINK trial is exactly two instructed
            # blinks: take the two largest-amplitude candidates (not simply
            # the first two in time) before computing their spacing.
            if len(candidates) >= 2:
                top_two = sorted(candidates, key=_peak_uv, reverse=True)[:2]
                a, b = sorted(top_two, key=lambda c: c.start_time_s)
                spacing = b.start_time_s - a.end_time_s
                if spacing > 0:
                    double_spacings.append(spacing)
                # b is the second (later) pulse — the one riding the first
                # pulse's still-decaying filter tail. Measure its *actual*
                # classifier-equivalent prominence (not just peak amplitude)
                # so derive_config_overrides can use real data, not a guess,
                # as the ceiling on min_prominence_uv — see that method.
                b_features = extract_features(
                    b.frontal_window, b.af7_window, b.af8_window, fs_hz,
                    baseline_level=stats.noise_floor_median,
                    time_since_previous_valid_blink_s=spacing if spacing > 0 else 0.0,
                )
                double_second_pulse_prominences.append(b_features.peak_prominence)
                double_second_pulse_durations.append(b.duration_s)

    stats.normal_blink_peak_median, stats.normal_blink_peak_mad = _median_mad(normal_peaks)
    stats.n_rest_candidates = len(normal_peaks)

    stats.intentional_blink_peak_median, stats.intentional_blink_peak_mad = _median_mad(intentional_peaks)
    stats.intentional_duration_median_s, stats.intentional_duration_mad_s = _median_mad(intentional_durations)
    stats.intentional_rise_time_median_s, _ = _median_mad(intentional_rise_times)
    stats.intentional_fall_time_median_s, _ = _median_mad(intentional_fall_times)
    stats.n_single_candidates = len(intentional_peaks)

    stats.double_blink_spacing_median_s, stats.double_blink_spacing_mad_s = _median_mad(double_spacings)
    stats.n_double_pairs = len(double_spacings)

    stats.double_blink_second_pulse_prominence_median, stats.double_blink_second_pulse_prominence_mad = (
        _median_mad(double_second_pulse_prominences)
    )
    stats.double_blink_second_pulse_duration_median_s, stats.double_blink_second_pulse_duration_mad_s = (
        _median_mad(double_second_pulse_durations)
    )

    return stats
