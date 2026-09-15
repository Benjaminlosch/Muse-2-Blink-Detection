"""Synthetic Muse-2-like signal generator.

Produces AF7/AF8/TP9/TP10 traces (plus a coarse IMU accel trace) with known
ground-truth event labels, so the entire downstream pipeline (filters,
candidate detector, features, classifier, state machine, gate) can be
exercised and tested without physical hardware.

This is a *plausibility* simulator for engineering/test purposes, not a
validated physiological model — amplitudes/shapes are chosen to be in a
reasonable ballpark for frontal EEG/EOG (blinks: tens to low hundreds of
microvolts; background EEG: single-digit to ~20 uV) but are NOT taken from a
specific paper. Real recorded data (docs/CALIBRATION.md) is what actually
tunes the production thresholds.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

CHANNELS = ("AF7", "AF8", "TP9", "TP10")


@dataclass
class SimEvent:
    label: str
    onset_s: float
    duration_s: float
    params: dict = field(default_factory=dict)


@dataclass
class SimulatedRecording:
    fs_hz: float
    timestamps: np.ndarray
    channels: dict  # name -> np.ndarray, one entry per CHANNELS
    accel: dict  # "x","y","z" -> np.ndarray (same length as timestamps, upsampled)
    ground_truth: list  # list of (start_s, end_s, label)


def _double_exp_pulse(n: int, rise_frac: float = 0.35) -> np.ndarray:
    """A causal-looking asymmetric bump: fast-ish rise, slower fall — a
    simple, cheap stand-in for a blink-shaped ocular transient."""
    t = np.linspace(0, 1, n)
    rise = 1 - np.exp(-t / max(rise_frac, 1e-3))
    fall = np.exp(-t / max(1 - rise_frac, 1e-3))
    shape = rise * fall
    shape = shape / (np.max(shape) + 1e-12)
    return shape


class SignalSimulator:
    def __init__(self, fs_hz: float = 256.0, imu_fs_hz: float = 52.0, seed: int | None = 42):
        self.fs_hz = fs_hz
        self.imu_fs_hz = imu_fs_hz
        self.rng = np.random.default_rng(seed)

    # ---- baseline -----------------------------------------------------
    def _baseline_noise(self, n: int, std_uv: float = 4.0) -> np.ndarray:
        # 1/f-ish "pink" noise approximation: filtered white noise, plus a
        # weak ~10 Hz alpha-like oscillation to stand in for normal EEG.
        white = self.rng.normal(0, std_uv, n)
        kernel = np.array([0.25, 0.5, 0.25])
        pink = np.convolve(white, kernel, mode="same")
        t = np.arange(n) / self.fs_hz
        alpha = 1.5 * np.sin(2 * np.pi * 10.0 * t + self.rng.uniform(0, 2 * np.pi))
        return pink + alpha

    def render(self, total_duration_s: float, events: list[SimEvent]) -> SimulatedRecording:
        n = int(total_duration_s * self.fs_hz)
        timestamps = np.arange(n) / self.fs_hz

        channels = {ch: self._baseline_noise(n) for ch in CHANNELS}
        n_imu = int(total_duration_s * self.imu_fs_hz)
        accel_small = {
            "x": self.rng.normal(0, 0.01, n_imu),
            "y": self.rng.normal(0, 0.01, n_imu),
            "z": 1.0 + self.rng.normal(0, 0.01, n_imu),
        }

        ground_truth: list[tuple[float, float, str]] = []

        for ev in sorted(events, key=lambda e: e.onset_s):
            handler = getattr(self, f"_apply_{ev.label.lower()}", None)
            if handler is None:
                raise ValueError(f"Unknown simulation event label: {ev.label}")
            handler(channels, accel_small, timestamps, ev)
            ground_truth.append((ev.onset_s, ev.onset_s + ev.duration_s, ev.label))

        # Upsample IMU (nearest-neighbor is fine for this coarse veto signal)
        accel = {}
        if n_imu > 1:
            imu_t = np.arange(n_imu) / self.imu_fs_hz
            for axis in ("x", "y", "z"):
                accel[axis] = np.interp(timestamps, imu_t, accel_small[axis])
        else:
            accel = {axis: np.full(n, accel_small[axis][0] if n_imu else 0.0) for axis in ("x", "y", "z")}

        return SimulatedRecording(
            fs_hz=self.fs_hz, timestamps=timestamps, channels=channels, accel=accel, ground_truth=ground_truth
        )

    # ---- event handlers -------------------------------------------------
    def _slice(self, timestamps: np.ndarray, onset_s: float, duration_s: float):
        start_idx = int(onset_s * self.fs_hz)
        n = max(int(duration_s * self.fs_hz), 1)
        end_idx = min(start_idx + n, len(timestamps))
        start_idx = max(start_idx, 0)
        return start_idx, end_idx

    def _apply_single_blink(self, channels, accel, timestamps, ev: SimEvent):
        amp = ev.params.get("amplitude_uv", 90.0)
        self._add_blink_pulse(channels, timestamps, ev.onset_s, ev.duration_s, amp, corr=0.97)

    def _apply_double_blink(self, channels, accel, timestamps, ev: SimEvent):
        amp = ev.params.get("amplitude_uv", 90.0)
        gap_s = ev.params.get("gap_s", 0.25)
        single_dur = ev.params.get("single_duration_s", 0.18)
        self._add_blink_pulse(channels, timestamps, ev.onset_s, single_dur, amp, corr=0.97)
        self._add_blink_pulse(channels, timestamps, ev.onset_s + single_dur + gap_s, single_dur, amp, corr=0.97)

    def _apply_slow_blink(self, channels, accel, timestamps, ev: SimEvent):
        amp = ev.params.get("amplitude_uv", 80.0)
        self._add_blink_pulse(channels, timestamps, ev.onset_s, ev.duration_s, amp, corr=0.95, rise_frac=0.5)

    def _apply_oversized_transient(self, channels, accel, timestamps, ev: SimEvent):
        amp = ev.params.get("amplitude_uv", 400.0)
        self._add_blink_pulse(channels, timestamps, ev.onset_s, ev.duration_s, amp, corr=0.9)

    def _apply_random_spike(self, channels, accel, timestamps, ev: SimEvent):
        amp = ev.params.get("amplitude_uv", 150.0)
        target = ev.params.get("channel", None)
        start_idx, end_idx = self._slice(timestamps, ev.onset_s, ev.duration_s)
        targets = [target] if target else CHANNELS
        for ch in targets:
            spike = np.zeros(end_idx - start_idx)
            if len(spike) > 0:
                spike[0] = amp * self.rng.choice([-1, 1])
            channels[ch][start_idx:end_idx] += spike

    def _apply_head_motion(self, channels, accel, timestamps, ev: SimEvent):
        amp = ev.params.get("amplitude_uv", 60.0)
        accel_g = ev.params.get("accel_g", 0.3)
        start_idx, end_idx = self._slice(timestamps, ev.onset_s, ev.duration_s)
        n = end_idx - start_idx
        if n <= 0:
            return
        t = np.linspace(0, np.pi, n)
        wobble = amp * np.sin(t) * np.hanning(n)
        for ch in CHANNELS:
            jitter = self.rng.normal(0, 0.1) * wobble
            channels[ch][start_idx:end_idx] += wobble + jitter

        imu_start = int(ev.onset_s * self.imu_fs_hz)
        imu_n = max(int(ev.duration_s * self.imu_fs_hz), 1)
        imu_end = min(imu_start + imu_n, len(accel["x"]))
        imu_start = max(imu_start, 0)
        if imu_end > imu_start:
            burst = accel_g * np.hanning(imu_end - imu_start)
            accel["x"][imu_start:imu_end] += burst
            accel["y"][imu_start:imu_end] += burst * 0.5

    def _apply_muscle_burst(self, channels, accel, timestamps, ev: SimEvent):
        amp = ev.params.get("amplitude_uv", 70.0)
        start_idx, end_idx = self._slice(timestamps, ev.onset_s, ev.duration_s)
        n = end_idx - start_idx
        if n <= 0:
            return
        burst = self.rng.normal(0, amp, n) * np.hanning(n)
        for ch in CHANNELS:
            channels[ch][start_idx:end_idx] += burst * self.rng.uniform(0.6, 1.0)

    def _apply_jaw_clench(self, channels, accel, timestamps, ev: SimEvent):
        amp = ev.params.get("amplitude_uv", 130.0)
        start_idx, end_idx = self._slice(timestamps, ev.onset_s, ev.duration_s)
        n = end_idx - start_idx
        if n <= 0:
            return
        window = np.hanning(n)
        for ch in CHANNELS:
            burst = self.rng.normal(0, amp, n) * window
            channels[ch][start_idx:end_idx] += burst

    def _apply_baseline_drift(self, channels, accel, timestamps, ev: SimEvent):
        amp = ev.params.get("amplitude_uv", 50.0)
        start_idx, end_idx = self._slice(timestamps, ev.onset_s, ev.duration_s)
        n = end_idx - start_idx
        if n <= 0:
            return
        t = np.linspace(0, 1, n)
        drift = amp * (0.5 - 0.5 * np.cos(np.pi * t))
        for ch in CHANNELS:
            channels[ch][start_idx:end_idx] += drift

    def _apply_sixty_hz(self, channels, accel, timestamps, ev: SimEvent):
        amp = ev.params.get("amplitude_uv", 15.0)
        start_idx, end_idx = self._slice(timestamps, ev.onset_s, ev.duration_s)
        n = end_idx - start_idx
        if n <= 0:
            return
        t = timestamps[start_idx:end_idx]
        interference = amp * np.sin(2 * np.pi * 60.0 * t)
        for ch in CHANNELS:
            channels[ch][start_idx:end_idx] += interference * self.rng.uniform(0.8, 1.2)

    def _apply_electrode_dropout(self, channels, accel, timestamps, ev: SimEvent):
        target = ev.params.get("channel", "AF7")
        start_idx, end_idx = self._slice(timestamps, ev.onset_s, ev.duration_s)
        if end_idx > start_idx:
            channels[target][start_idx:end_idx] = ev.params.get("flat_value_uv", 0.0)

    def _apply_single_channel_artifact(self, channels, accel, timestamps, ev: SimEvent):
        target = ev.params.get("channel", "AF7")
        amp = ev.params.get("amplitude_uv", 120.0)
        self._add_blink_pulse({target: channels[target]}, timestamps, ev.onset_s, ev.duration_s, amp, corr=1.0)

    def _add_blink_pulse(self, channels, timestamps, onset_s, duration_s, amp_uv, corr=0.95, rise_frac=0.35):
        start_idx, end_idx = self._slice(timestamps, onset_s, duration_s)
        n = end_idx - start_idx
        if n <= 0:
            return
        shape = _double_exp_pulse(n, rise_frac=rise_frac) * amp_uv
        for ch in channels:
            if ch in ("AF7", "AF8"):
                asym = self.rng.normal(1.0, (1 - corr) * 0.3)
                channels[ch][start_idx:end_idx] += shape * asym
            elif ch in ("TP9", "TP10"):
                # Weak volume-conducted remnant at the reference channels.
                channels[ch][start_idx:end_idx] += shape * 0.15


def build_demo_scenario() -> list[SimEvent]:
    """One of every event type, spaced out, for manual inspection / demos /
    the offline analysis smoke test. Order and spacing chosen only for
    visual/test clarity."""
    events = [
        SimEvent("single_blink", onset_s=2.0, duration_s=0.20, params={"amplitude_uv": 90}),
        # duration_s = 2 * default single_duration_s (0.18) + gap_s, so the
        # registered ground-truth window tightly bounds the actually
        # generated two-pulse waveform (see _apply_double_blink) instead of
        # drifting out of sync with it.
        SimEvent("double_blink", onset_s=5.0, duration_s=0.58, params={"amplitude_uv": 95, "gap_s": 0.22}),
        SimEvent("slow_blink", onset_s=9.0, duration_s=0.45, params={"amplitude_uv": 80}),
        SimEvent("oversized_transient", onset_s=12.0, duration_s=0.30, params={"amplitude_uv": 450}),
        SimEvent("random_spike", onset_s=15.0, duration_s=0.02, params={"amplitude_uv": 150}),
        SimEvent("head_motion", onset_s=17.0, duration_s=0.8, params={"amplitude_uv": 60, "accel_g": 0.35}),
        SimEvent("muscle_burst", onset_s=20.0, duration_s=0.4, params={"amplitude_uv": 70}),
        SimEvent("jaw_clench", onset_s=23.0, duration_s=0.6, params={"amplitude_uv": 130}),
        SimEvent("baseline_drift", onset_s=26.0, duration_s=3.0, params={"amplitude_uv": 50}),
        SimEvent("sixty_hz", onset_s=30.0, duration_s=2.0, params={"amplitude_uv": 15}),
        SimEvent("electrode_dropout", onset_s=33.0, duration_s=1.5, params={"channel": "AF7"}),
        SimEvent("single_channel_artifact", onset_s=36.0, duration_s=0.2, params={"channel": "AF8", "amplitude_uv": 120}),
        SimEvent("double_blink", onset_s=39.0, duration_s=0.54, params={"amplitude_uv": 95, "gap_s": 0.18}),
    ]
    return events
