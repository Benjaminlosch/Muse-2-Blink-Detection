"""Interpretable, rule-based single-blink-candidate classifier.

Deliberately NOT a trained ML model (see project brief section 27): this is
filtering + adaptive thresholds + waveform morphology + channel agreement +
artifact rejection, combined into a bounded [0,1] confidence score. A hard
rejection (any gate fails) always wins over a soft confidence combination —
we never let a high score on other features compensate for e.g. a failed
AF7/AF8 agreement check.

This is a starting heuristic. The relative weighting of soft-score components
below is an engineering judgment call, not a value derived from a paper or
from real user data — it MUST be revisited once real recordings exist (see
docs/CALIBRATION.md and offline_analysis outputs for false-activation rate).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ..detection.adaptive_threshold import MAD_TO_SIGMA
from ..detection.calibration import CalibrationStats
from ..detection.candidate_detector import BlinkCandidate
from ..detection.features import BlinkFeatures
from ..detection.signal_quality import SignalQualityStatus


@dataclass
class ClassificationResult:
    is_valid_blink: bool
    confidence: float
    rejection_reasons: list[str] = field(default_factory=list)
    component_scores: dict = field(default_factory=dict)


def _clip01(x: float) -> float:
    return float(min(max(x, 0.0), 1.0))


def classify_candidate(
    candidate: BlinkCandidate,
    features: BlinkFeatures,
    signal_quality: SignalQualityStatus,
    calibration: CalibrationStats,
    min_prominence_uv: float,
    min_blink_width_s: float,
    max_blink_width_s: float,
    af7_af8_min_correlation: float,
    af7_af8_max_amplitude_ratio: float,
    min_signal_quality: float,
    motion_veto_active: bool = False,
    motion_veto_confidence_penalty: float = 0.5,
) -> ClassificationResult:
    reasons: list[str] = []

    # --- Hard gates (any failure -> reject outright) -----------------------
    if not candidate.width_valid or not (min_blink_width_s <= features.duration_s <= max_blink_width_s):
        reasons.append("duration_out_of_range")

    if candidate.likely_filter_rebound:
        reasons.append("filter_rebound_bounce")

    if signal_quality.flatline:
        reasons.append("electrode_dropout_flatline")
    if signal_quality.railed:
        reasons.append("railed_or_oversized_transient")
    if signal_quality.quality < min_signal_quality:
        reasons.append("poor_signal_quality")

    if features.peak_prominence < min_prominence_uv:
        reasons.append("insufficient_prominence")

    if features.af7_af8_correlation < af7_af8_min_correlation:
        reasons.append("af7_af8_disagreement_correlation")
    if features.af7_af8_amplitude_ratio > af7_af8_max_amplitude_ratio:
        reasons.append("af7_af8_disagreement_amplitude_ratio")

    # Rise/fall sanity: a genuine blink has both a rise and a fall within the
    # candidate window. A pure step/ramp (e.g. baseline drift briefly crossing
    # threshold) tends to have a degenerate rise or fall time near zero.
    if features.rise_time_s <= 0 or features.fall_time_s <= 0:
        reasons.append("degenerate_rise_fall_shape")

    if reasons:
        return ClassificationResult(is_valid_blink=False, confidence=0.0, rejection_reasons=reasons)

    # --- Soft confidence (geometric mean: one weak component drags all down) ---
    quality_score = _clip01(signal_quality.quality)

    corr_span = max(1.0 - af7_af8_min_correlation, 1e-6)
    agreement_corr_score = _clip01((features.af7_af8_correlation - af7_af8_min_correlation) / corr_span)
    ratio_span = max(af7_af8_max_amplitude_ratio - 1.0, 1e-6)
    agreement_ratio_score = _clip01(1.0 - (features.af7_af8_amplitude_ratio - 1.0) / ratio_span)
    agreement_score = (agreement_corr_score * agreement_ratio_score) ** 0.5

    if calibration.noise_floor_mad > 0:
        noise_sigma = calibration.noise_floor_mad * MAD_TO_SIGMA
        z = (features.peak_prominence - calibration.noise_floor_median) / max(noise_sigma, 1e-9)
        # Map robust z-score onto [0,1] over an 8-sigma span above the noise floor.
        prominence_score = _clip01(z / 8.0)
    else:
        # No calibration yet: fall back to margin above the configured minimum.
        prominence_score = _clip01(features.peak_prominence / max(min_prominence_uv * 2.0, 1e-9))

    components = {
        "quality_score": quality_score,
        "agreement_score": agreement_score,
        "prominence_score": prominence_score,
    }
    confidence = float(np.prod(list(components.values())) ** (1.0 / len(components)))

    if motion_veto_active:
        confidence *= (1.0 - motion_veto_confidence_penalty)
        components["motion_veto_penalty_applied"] = motion_veto_confidence_penalty

    return ClassificationResult(
        is_valid_blink=True, confidence=_clip01(confidence), rejection_reasons=[], component_scores=components
    )
