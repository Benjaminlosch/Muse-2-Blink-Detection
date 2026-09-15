"""IMU-based motion-artifact veto (optional, configurable).

Per project brief section 8: if accelerometer/IMU data is available, use
large simultaneous head acceleration to reject or down-weight a blink-like
EEG transient. Disabled entirely (config.motion_veto.enabled=false) falls
back to EEG-only rejection so legitimate blinking while moving isn't
automatically impossible when IMU data isn't trustworthy/available.
"""
from __future__ import annotations

from collections import deque

import numpy as np


class MotionVetoMonitor:
    def __init__(self, fs_hz: float, window_s: float = 0.5, energy_threshold_g2: float = 0.05):
        self.maxlen = max(int(window_s * fs_hz), 2)
        self.energy_threshold_g2 = energy_threshold_g2
        self._buf: deque[tuple[float, float, float]] = deque(maxlen=self.maxlen)

    def update(self, accel_x: float | None, accel_y: float | None, accel_z: float | None) -> float:
        """Feed one IMU sample (already upsampled/aligned to the EEG stream by
        the acquisition source). Returns the current motion-energy estimate
        (variance of deviation from 1g, in g^2)."""
        if accel_x is None or accel_y is None or accel_z is None:
            return 0.0
        self._buf.append((accel_x, accel_y, accel_z))
        if len(self._buf) < 2:
            return 0.0
        arr = np.array(self._buf, dtype=np.float64)
        magnitude = np.linalg.norm(arr, axis=1)
        deviation = magnitude - 1.0  # 1g at rest
        return float(np.var(deviation))

    def is_motion_artifact(self, motion_energy_g2: float) -> bool:
        return motion_energy_g2 > self.energy_threshold_g2
