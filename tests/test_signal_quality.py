"""Tests for detection/signal_quality.py electrode-health monitoring."""
from __future__ import annotations

from bcihand.detection.signal_quality import SignalQualityMonitor

FS = 256.0


def test_flatline_detected_on_dead_electrode():
    monitor = SignalQualityMonitor(FS, window_s=0.5)
    status = None
    for _ in range(int(0.5 * FS) + 1):
        status = monitor.update(0.0)  # perfectly flat -> dropout
    assert status.flatline is True
    assert status.quality == 0.0


def test_railed_detected_on_oversized_transient():
    monitor = SignalQualityMonitor(FS, window_s=0.5, railed_abs_uv=400.0)
    status = None
    for i in range(int(0.5 * FS) + 1):
        v = 800.0 if i == 5 else 1.0
        status = monitor.update(v)
    assert status.railed is True
    assert status.quality == 0.0


def test_excessive_noise_detected():
    import numpy as np

    # std=80 clears the 50uV excessive-noise threshold with margin while
    # staying well clear of the (default 400uV) railed threshold, so this
    # test isolates excessive_noise rather than also tripping railed.
    monitor = SignalQualityMonitor(FS, window_s=0.5, excessive_noise_std_uv=50.0)
    rng = np.random.default_rng(0)
    status = None
    for _ in range(int(0.5 * FS) + 1):
        status = monitor.update(float(rng.normal(0, 80.0)))
    assert status.excessive_noise is True
    assert status.railed is False
    assert status.quality == 0.2


def test_clean_signal_reports_good_quality():
    monitor = SignalQualityMonitor(FS, window_s=0.5)
    status = None
    for i in range(int(0.5 * FS) + 1):
        status = monitor.update(5.0 * ((i % 2) * 2 - 1))  # small alternating signal
    assert status.quality == 1.0
    assert not status.flatline
    assert not status.railed
    assert not status.excessive_noise


def test_warmup_period_reports_neutral_quality():
    monitor = SignalQualityMonitor(FS, window_s=1.0)
    status = monitor.update(0.0)
    assert status.quality == 0.5
