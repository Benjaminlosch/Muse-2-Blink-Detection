"""The full real-time blink pipeline, wired from config/default_config.yaml.

    Sample -> per-channel causal filter -> frontal_mean/difference ->
    candidate detector -> feature extraction -> artifact rejection/classifier
    -> double/single-blink state machine -> confidence gate -> Command

`BlinkPipeline.process_sample()` is the single entry point used by both the
live acquisition loop (scripts/run_pipeline.py) and every test in
tests/test_end_to_end_simulation.py — the exact same code path runs on
simulated and (eventually) real Muse 2 data, per project brief section 15.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from .acquisition.base import Sample
from .classification.blink_classifier import classify_candidate, ClassificationResult
from .classification.command_mapper import Command, HandStateTracker
from .classification.confidence_gate import gate_event, GateDecision
from .classification.state_machine import DoubleBlinkStateMachine, BlinkStateMachineEvent
from .detection.calibration import CalibrationStats
from .detection.candidate_detector import CandidateDetector, BlinkCandidate
from .detection.features import extract_features, BlinkFeatures
from .detection.motion_veto import MotionVetoMonitor
from .detection.signal_quality import SignalQualityMonitor, SignalQualityStatus
from .dsp.filters import CausalBlinkBandFilter
from .dsp.spatial import frontal_mean
from .utils.config import ConfigNode
from .utils.latency import LatencyProfiler


@dataclass
class PipelineStepResult:
    timestamp_s: float
    filtered_af7: float
    filtered_af8: float
    frontal_signal: float
    signal_quality: SignalQualityStatus
    adaptive_threshold: float
    candidate: BlinkCandidate | None = None
    features: BlinkFeatures | None = None
    classification: ClassificationResult | None = None
    state_event: BlinkStateMachineEvent | None = None
    gate_decision: GateDecision | None = None


_VALID_CHANNEL_NAMES = ("af7", "af8", "tp9", "tp10")


def _channel_value(sample: Sample, channel_name: str) -> float:
    """Reads one of Sample's four raw EEG fields by name (case-insensitive:
    "AF7"/"af7" etc.) — the indirection that lets acquisition.primary_channels
    pick which two physical electrodes feed detection, per-user, without
    touching any downstream DSP/detection/classification code (those only
    ever see "channel A" / "channel B", never a hardcoded electrode)."""
    key = channel_name.strip().lower()
    if key not in _VALID_CHANNEL_NAMES:
        raise ValueError(f"Unknown channel '{channel_name}'; must be one of {_VALID_CHANNEL_NAMES}")
    return getattr(sample, key)


class BlinkPipeline:
    def __init__(self, config: ConfigNode, fs_hz: float, comm_ok_provider=None):
        self.config = config
        self.fs_hz = fs_hz
        # comm_ok_provider: zero-arg callable returning current comm health;
        # defaults to "always healthy" for offline/simulated runs where no
        # ESP32 link exists.
        self.comm_ok_provider = comm_ok_provider or (lambda: True)

        # Which two raw channels feed detection. Defaults to AF7/AF8 (the
        # anatomically conventional bilateral-ocular pair) but is entirely a
        # per-user/per-headset calibration choice, not a fixed physiological
        # fact: on real Muse 2 hardware, forehead (AF7/AF8) dry-electrode
        # contact is often worse than the ear-clip TP9/TP10 contact, and a
        # user should pick whichever pair actually shows clean blinks on
        # their own Live EEG view — see docs/CALIBRATION.md "Channel
        # selection."
        primary = list(config.acquisition.get("primary_channels", ["AF7", "AF8"]))
        if len(primary) != 2:
            raise ValueError(f"acquisition.primary_channels must have exactly 2 entries, got {primary!r}")
        for name in primary:
            if name.strip().lower() not in _VALID_CHANNEL_NAMES:
                raise ValueError(f"Unknown channel '{name}' in acquisition.primary_channels; must be one of {_VALID_CHANNEL_NAMES}")
        self._channel_a, self._channel_b = primary[0], primary[1]

        dsp_cfg = config.dsp
        self.filter_af7 = CausalBlinkBandFilter(
            fs_hz, dsp_cfg.highpass_hz, dsp_cfg.lowpass_hz, dsp_cfg.filter_order,
            dsp_cfg.notch_hz if dsp_cfg.notch_enabled else None, dsp_cfg.notch_quality_factor,
            dsp_cfg.baseline_tracker_time_constant_s,
        )
        self.filter_af8 = CausalBlinkBandFilter(
            fs_hz, dsp_cfg.highpass_hz, dsp_cfg.lowpass_hz, dsp_cfg.filter_order,
            dsp_cfg.notch_hz if dsp_cfg.notch_enabled else None, dsp_cfg.notch_quality_factor,
            dsp_cfg.baseline_tracker_time_constant_s,
        )

        cd_cfg = config.candidate_detection
        self.candidate_detector = CandidateDetector(
            fs_hz=fs_hz,
            min_blink_width_s=cd_cfg.min_blink_width_s,
            max_blink_width_s=cd_cfg.max_blink_width_s,
            refractory_after_candidate_s=cd_cfg.refractory_after_candidate_s,
            threshold_mad_multiplier=cd_cfg.threshold_mad_multiplier,
            rebound_guard_s=cd_cfg.get("rebound_guard_s", 0.30),
            rebound_refractory_s=cd_cfg.get("rebound_refractory_s", 0.02),
        )

        db_cfg = config.double_blink
        self.state_machine = DoubleBlinkStateMachine(
            min_interval_s=db_cfg.min_interval_s,
            max_interval_s=db_cfg.max_interval_s,
            wait_for_second_timeout_s=db_cfg.wait_for_second_timeout_s,
            refractory_after_double_s=db_cfg.refractory_after_double_s,
        )

        self.sq_monitor_af7 = SignalQualityMonitor(fs_hz)
        self.sq_monitor_af8 = SignalQualityMonitor(fs_hz)

        self.motion_veto = MotionVetoMonitor(
            fs_hz, energy_threshold_g2=config.motion_veto.accel_energy_threshold_g2
        )

        self.hand_state = HandStateTracker()

        calib_dict = config.get("calibration_stats", None)
        if calib_dict is not None:
            known = {f: calib_dict.to_dict().get(f, 0.0) for f in CalibrationStats().__dict__}
            self.calibration_stats = CalibrationStats(**known)
        else:
            self.calibration_stats = CalibrationStats()

        self._last_valid_blink_time: float | None = None
        self.latency = LatencyProfiler()

    def process_sample(self, sample: Sample) -> PipelineStepResult:
        t_ingest = time.perf_counter()

        raw_a = _channel_value(sample, self._channel_a)
        raw_b = _channel_value(sample, self._channel_b)
        filtered_af7 = self.filter_af7.process_sample(raw_a)
        filtered_af8 = self.filter_af8.process_sample(raw_b)
        frontal = frontal_mean(filtered_af7, filtered_af8)
        t_filtered = time.perf_counter()
        self.latency.record("filtering", t_filtered - t_ingest)

        sq_af7 = self.sq_monitor_af7.update(raw_a)
        sq_af8 = self.sq_monitor_af8.update(raw_b)
        combined_quality = min(sq_af7.quality, sq_af8.quality)
        combined_flatline = sq_af7.flatline or sq_af8.flatline
        combined_railed = sq_af7.railed or sq_af8.railed
        combined_noise = sq_af7.excessive_noise or sq_af8.excessive_noise
        signal_quality = SignalQualityStatus(
            quality=combined_quality, flatline=combined_flatline, railed=combined_railed,
            excessive_noise=combined_noise,
        )

        motion_energy = self.motion_veto.update(sample.accel_x, sample.accel_y, sample.accel_z)

        candidate = self.candidate_detector.process_sample(frontal, filtered_af7, filtered_af8)
        t_candidate = time.perf_counter()
        self.latency.record("candidate_detection", t_candidate - t_filtered)

        features = None
        classification = None
        state_event = None

        if candidate is not None:
            time_since_prev = (
                sample.timestamp_s - self._last_valid_blink_time
                if self._last_valid_blink_time is not None
                else float("inf")
            )
            spatial_cfg = self.config.spatial
            features = extract_features(
                candidate.frontal_window, candidate.af7_window, candidate.af8_window, self.fs_hz,
                baseline_level=self.candidate_detector.threshold.noise_floor_median,
                time_since_previous_valid_blink_s=time_since_prev,
                agreement_min_correlation=spatial_cfg.af7_af8_min_correlation,
                agreement_max_amplitude_ratio=spatial_cfg.af7_af8_max_amplitude_ratio,
            )

            motion_veto_active = (
                self.config.motion_veto.enabled and self.motion_veto.is_motion_artifact(motion_energy)
            )

            cd_cfg = self.config.candidate_detection
            classification = classify_candidate(
                candidate, features, signal_quality, self.calibration_stats,
                min_prominence_uv=cd_cfg.min_prominence_uv,
                min_blink_width_s=cd_cfg.min_blink_width_s,
                max_blink_width_s=cd_cfg.max_blink_width_s,
                af7_af8_min_correlation=spatial_cfg.af7_af8_min_correlation,
                af7_af8_max_amplitude_ratio=spatial_cfg.af7_af8_max_amplitude_ratio,
                min_signal_quality=self.config.confidence.min_signal_quality,
                motion_veto_active=motion_veto_active,
                motion_veto_confidence_penalty=self.config.motion_veto.confidence_penalty,
            )
            t_classified = time.perf_counter()
            self.latency.record("classification", t_classified - t_candidate)

            if classification.is_valid_blink:
                state_event = self.state_machine.process_valid_blink(sample.timestamp_s, classification.confidence)
                self._last_valid_blink_time = sample.timestamp_s
        else:
            state_event = self.state_machine.poll_timeout(sample.timestamp_s)

        t_state = time.perf_counter()
        if state_event is not None:
            self.latency.record("double_blink_confirmation", t_state - t_candidate)

        signal_quality_ok = (
            signal_quality.quality >= self.config.confidence.min_signal_quality
            and not signal_quality.flatline
            and not signal_quality.railed
        )
        comm_ok = self.comm_ok_provider()

        gate_decision = gate_event(
            state_event, signal_quality_ok, comm_ok,
            self.config.confidence.high_confidence_threshold,
            self.config.confidence.medium_confidence_threshold,
            self.config.communication.command_mapping.to_dict(),
            self.hand_state,
        )

        if state_event is not None:
            self.latency.record_total(t_state - t_ingest)

        return PipelineStepResult(
            timestamp_s=sample.timestamp_s,
            filtered_af7=filtered_af7,
            filtered_af8=filtered_af8,
            frontal_signal=frontal,
            signal_quality=signal_quality,
            adaptive_threshold=self.candidate_detector.threshold.threshold,
            candidate=candidate,
            features=features,
            classification=classification,
            state_event=state_event,
            gate_decision=gate_decision,
        )
