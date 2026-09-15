"""Lightweight, streaming signal-quality indicators.

Used both as a candidate-rejection input and as a direct confidence-gate
input (POOR SIGNAL QUALITY -> HOLD, per docs/SAFETY.md).
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np


@dataclass
class SignalQualityStatus:
    quality: float  # 0..1, 1 = good
    flatline: bool
    railed: bool
    excessive_noise: bool


class SignalQualityMonitor:
    """Tracks a short rolling window per channel to flag electrode dropout
    (flatline), railing/saturation, and excessive broadband noise."""

    def __init__(
        self,
        fs_hz: float,
        window_s: float = 1.0,
        flatline_std_uv: float = 0.05,
        railed_abs_uv: float = 400.0,
        excessive_noise_std_uv: float = 150.0,
    ):
        self.fs_hz = fs_hz
        self.maxlen = max(int(window_s * fs_hz), 4)
        self.flatline_std_uv = flatline_std_uv
        self.railed_abs_uv = railed_abs_uv
        self.excessive_noise_std_uv = excessive_noise_std_uv
        self._buf: deque[float] = deque(maxlen=self.maxlen)

    def update(self, raw_sample_uv: float) -> SignalQualityStatus:
        self._buf.append(raw_sample_uv)
        if len(self._buf) < self.maxlen:
            return SignalQualityStatus(quality=0.5, flatline=False, railed=False, excessive_noise=False)

        arr = np.fromiter(self._buf, dtype=np.float64, count=len(self._buf))
        std = float(np.std(arr))
        max_abs = float(np.max(np.abs(arr)))

        flatline = std < self.flatline_std_uv
        railed = max_abs > self.railed_abs_uv
        excessive_noise = std > self.excessive_noise_std_uv

        if flatline or railed:
            quality = 0.0
        elif excessive_noise:
            quality = 0.2
        else:
            quality = 1.0

        return SignalQualityStatus(quality=quality, flatline=flatline, railed=railed, excessive_noise=excessive_noise)
