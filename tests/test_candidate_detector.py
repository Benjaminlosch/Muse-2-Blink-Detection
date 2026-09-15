"""Tests for the causal streaming blink-candidate detector.

Verifies the behaviors documented in candidate_detector.py's module
docstring: width-bounded candidates, refractory debounce, oversized-
transient truncation (never counted as a valid width), and filter-rebound
rejection (the causal bandpass's own opposite-sign overshoot following a
real blink must not become a second candidate).
"""
from __future__ import annotations

import numpy as np

from bcihand.detection.candidate_detector import CandidateDetector
from bcihand.dsp.filters import CausalBlinkBandFilter

FS = 256.0


def test_isolated_blink_pulse_is_detected_with_valid_width():
    rng = np.random.default_rng(1)
    n_baseline = int(3 * FS)
    n_tail = int(2 * FS)
    baseline = rng.normal(0, 3.0, n_baseline)
    pulse = np.zeros(int(4 * FS))
    start = int(0.5 * FS)
    width = int(0.18 * FS)
    pulse[start:start + width] = 90.0
    x = np.concatenate([baseline, pulse, rng.normal(0, 3.0, n_tail)])

    chain = CausalBlinkBandFilter(FS, 0.5, 20.0, notch_hz=60.0)
    filtered = chain.process_block(x)

    detector = CandidateDetector(fs_hz=FS)
    candidates = [c for v in filtered if (c := detector.process_sample(v, v, v)) is not None]

    valid = [c for c in candidates if c.width_valid]
    assert len(valid) == 1
    blink = valid[0]
    assert blink.peak_sign == 1
    assert not blink.likely_filter_rebound
    assert 0.06 <= blink.duration_s <= 0.40


def test_filter_rebound_lobe_is_flagged_and_rejected():
    rng = np.random.default_rng(1)
    n_baseline = int(3 * FS)
    pulse = np.zeros(int(4 * FS))
    start = int(0.5 * FS)
    width = int(0.18 * FS)
    pulse[start:start + width] = 90.0
    x = np.concatenate([rng.normal(0, 3.0, n_baseline), pulse, rng.normal(0, 3.0, int(2 * FS))])

    chain = CausalBlinkBandFilter(FS, 0.5, 20.0, notch_hz=60.0)
    filtered = chain.process_block(x)

    detector = CandidateDetector(fs_hz=FS)
    candidates = [c for v in filtered if (c := detector.process_sample(v, v, v)) is not None]

    real_blink_idx = next(i for i, c in enumerate(candidates) if c.width_valid)
    real_blink = candidates[real_blink_idx]
    rebound = candidates[real_blink_idx + 1]

    assert rebound.peak_sign == -real_blink.peak_sign
    assert rebound.likely_filter_rebound is True
    assert rebound.start_time_s - real_blink.end_time_s < 0.30  # within rebound_guard_s default


def test_oversized_never_releasing_transient_is_truncated_and_invalid():
    detector = CandidateDetector(fs_hz=FS)
    # Warm up with a quiet, near-zero baseline so the adaptive threshold sits low.
    for _ in range(200):
        detector.process_sample(0.0, 0.0, 0.0)

    plateau_candidates = []
    for _ in range(200):  # far longer than max_blink_width_s (0.40s = ~102 samples)
        c = detector.process_sample(50.0, 50.0, 50.0)
        if c is not None:
            plateau_candidates.append(c)

    assert len(plateau_candidates) >= 1
    assert all(not c.width_valid for c in plateau_candidates)


def test_refractory_suppresses_immediate_rechatter():
    detector = CandidateDetector(
        fs_hz=FS, min_blink_width_s=0.02, max_blink_width_s=0.40, refractory_after_candidate_s=0.20
    )
    for _ in range(200):
        detector.process_sample(0.0, 0.0, 0.0)

    # A short blink-like pulse...
    candidates = []
    for v in [80.0] * 10 + [0.0] * 3:
        c = detector.process_sample(v, v, v)
        if c is not None:
            candidates.append(c)
    assert len(candidates) == 1

    # ...immediately followed by chatter that would otherwise cross threshold
    # again must be suppressed by the refractory period.
    for v in [80.0] * 5 + [0.0] * 3:
        c = detector.process_sample(v, v, v)
        if c is not None:
            candidates.append(c)
    assert len(candidates) == 1  # refractory absorbed the chatter


def test_below_min_width_transient_is_not_width_valid():
    detector = CandidateDetector(fs_hz=FS, min_blink_width_s=0.10, max_blink_width_s=0.40)
    for _ in range(200):
        detector.process_sample(0.0, 0.0, 0.0)

    candidates = []
    for v in [80.0, 80.0, 0.0]:  # ~2 samples above threshold, far too brief
        c = detector.process_sample(v, v, v)
        if c is not None:
            candidates.append(c)

    assert len(candidates) == 1
    assert candidates[0].width_valid is False


def test_reset_clears_internal_state():
    detector = CandidateDetector(fs_hz=FS)
    for _ in range(200):
        detector.process_sample(0.0, 0.0, 0.0)
    detector.process_sample(80.0, 80.0, 80.0)
    detector.reset()
    assert detector._state.value == "BELOW_THRESHOLD"
    assert detector._last_accepted_end_time_s is None
