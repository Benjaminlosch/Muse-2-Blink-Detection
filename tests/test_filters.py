"""Tests for the causal, sample-by-sample DSP building blocks (dsp/filters.py).

These confirm the production filter chain actually does what its docstrings
claim: rejects DC/baseline drift, attenuates 60 Hz interference, and passes
blink-band content with a causal (online, per-sample) implementation that
never looks at future samples.
"""
from __future__ import annotations

import numpy as np
import pytest

from bcihand.dsp.filters import (
    AdaptiveBaselineTracker,
    CausalBlinkBandFilter,
    StreamingSOS,
    design_bandpass_sos,
    design_notch_sos,
)

FS = 256.0


def _sine(freq_hz: float, duration_s: float, fs_hz: float = FS, amplitude: float = 1.0) -> np.ndarray:
    n = int(duration_s * fs_hz)
    t = np.arange(n) / fs_hz
    return amplitude * np.sin(2 * np.pi * freq_hz * t)


class TestAdaptiveBaselineTracker:
    def test_removes_dc_offset(self):
        tracker = AdaptiveBaselineTracker(fs_hz=FS, time_constant_s=1.0)
        x = np.full(2000, 500.0)  # large constant DC offset
        out = tracker.process_block(x)
        # After several time constants, output should have settled near zero.
        assert abs(out[-1]) < 5.0

    def test_first_sample_is_zero(self):
        tracker = AdaptiveBaselineTracker(fs_hz=FS, time_constant_s=1.0)
        # Baseline initializes to the first sample, so output starts at 0.
        assert tracker.process_sample(123.4) == pytest.approx(0.0)

    def test_tracks_slow_drift_but_passes_fast_signal(self):
        tracker = AdaptiveBaselineTracker(fs_hz=FS, time_constant_s=4.0)
        n = int(10 * FS)
        t = np.arange(n) / FS
        drift = 200.0 * t / 10.0  # slow linear ramp over 10s
        blink = np.zeros(n)
        blink_start = int(5 * FS)
        blink[blink_start:blink_start + 40] = 100.0  # ~0.16s pulse
        out = tracker.process_block(drift + blink)
        # The slow drift should be measurably attenuated relative to its raw
        # amplitude at that point (98uV)...
        assert abs(out[int(4.9 * FS)]) < 0.65 * drift[int(4.9 * FS)]
        # ...while the fast blink pulse passes through close to full amplitude.
        assert abs(out[blink_start + 5]) > 80.0

    def test_reset_clears_state(self):
        tracker = AdaptiveBaselineTracker(fs_hz=FS, time_constant_s=1.0)
        tracker.process_sample(500.0)
        tracker.reset()
        assert tracker.process_sample(10.0) == pytest.approx(0.0)


class TestStreamingSOS:
    def test_bandpass_passes_midband_attenuates_dc_and_high_freq(self):
        sos = design_bandpass_sos(FS, highpass_hz=0.5, lowpass_hz=20.0, order=2)
        filt = StreamingSOS(sos)

        dc = np.full(int(5 * FS), 100.0)
        out_dc = filt.process_block(dc)
        assert abs(out_dc[-1]) < 5.0  # DC should be rejected

        filt2 = StreamingSOS(sos)
        high = _sine(80.0, 3.0, amplitude=100.0)
        out_high = filt2.process_block(high)
        # steady-state amplitude of the tail should be strongly attenuated
        assert np.std(out_high[-200:]) < 0.3 * np.std(high[-200:])

        filt3 = StreamingSOS(sos)
        mid = _sine(5.0, 3.0, amplitude=100.0)
        out_mid = filt3.process_block(mid)
        # mid-band content well within the pass band should not be heavily attenuated
        assert np.std(out_mid[-200:]) > 0.5 * np.std(mid[-200:])

    def test_streaming_matches_block_processing(self):
        sos = design_bandpass_sos(FS, 0.5, 20.0, order=2)
        x = np.random.default_rng(0).normal(0, 50, 500)

        streaming = StreamingSOS(sos)
        out_sample_by_sample = np.array([streaming.process_sample(xi) for xi in x])

        from scipy.signal import sosfilt

        out_block, _ = sosfilt(sos, x, zi=np.zeros((sos.shape[0], 2)))

        np.testing.assert_allclose(out_sample_by_sample, out_block, atol=1e-9)

    def test_reset_clears_filter_state(self):
        sos = design_bandpass_sos(FS, 0.5, 20.0, order=2)
        filt = StreamingSOS(sos)
        filt.process_block(np.full(200, 100.0))
        filt.reset()
        assert np.all(filt.zi == 0.0)


class TestNotch:
    def test_60hz_notch_attenuates_60hz_tone(self):
        sos = design_notch_sos(FS, notch_hz=60.0, quality_factor=30.0)
        filt = StreamingSOS(sos)
        tone = _sine(60.0, 3.0, amplitude=100.0)
        out = filt.process_block(tone)
        # steady state should be strongly attenuated at the notch frequency
        assert np.std(out[-200:]) < 0.15 * np.std(tone[-200:])

    def test_notch_leaves_nearby_blink_band_relatively_intact(self):
        sos = design_notch_sos(FS, notch_hz=60.0, quality_factor=30.0)
        filt = StreamingSOS(sos)
        tone = _sine(5.0, 3.0, amplitude=100.0)
        out = filt.process_block(tone)
        assert np.std(out[-200:]) > 0.8 * np.std(tone[-200:])


class TestCausalBlinkBandFilter:
    def test_rejects_dc_and_60hz_combined(self):
        chain = CausalBlinkBandFilter(FS, highpass_hz=0.5, lowpass_hz=20.0, notch_hz=60.0)
        n = int(5 * FS)
        t = np.arange(n) / FS
        x = 300.0 + 20.0 * np.sin(2 * np.pi * 60.0 * t)
        out = chain.process_block(x)
        assert np.std(out[-200:]) < 5.0

    def test_passes_blink_shaped_pulse(self):
        chain = CausalBlinkBandFilter(FS, highpass_hz=0.5, lowpass_hz=20.0, notch_hz=60.0)
        n = int(3 * FS)
        x = np.zeros(n)
        start = int(1.0 * FS)
        width = int(0.15 * FS)
        x[start:start + width] = 100.0  # crude "blink-shaped" pulse
        out = chain.process_block(x)
        assert np.max(np.abs(out[start:start + width + 20])) > 30.0

    def test_no_notch_when_disabled(self):
        chain = CausalBlinkBandFilter(FS, highpass_hz=0.5, lowpass_hz=20.0, notch_hz=None)
        assert chain.notch is None

    def test_reset_is_idempotent_and_clears_state(self):
        chain = CausalBlinkBandFilter(FS, 0.5, 20.0, notch_hz=60.0)
        chain.process_block(np.full(500, 200.0))
        chain.reset()
        chain.reset()
        assert chain.baseline_tracker.baseline == 0.0


class TestFilterDesignValidation:
    def test_invalid_band_raises(self):
        with pytest.raises(ValueError):
            design_bandpass_sos(FS, highpass_hz=20.0, lowpass_hz=0.5)  # inverted

    def test_band_above_nyquist_raises(self):
        with pytest.raises(ValueError):
            design_bandpass_sos(FS, highpass_hz=0.5, lowpass_hz=300.0)
