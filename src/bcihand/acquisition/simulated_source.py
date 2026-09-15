"""EEGSource backed by the synthetic signal generator (src/bcihand/simulation).

Lets the whole pipeline run identically whether the samples come from a real
Muse 2 or from this simulator — same DSP, same detector, same classifier.
"""
from __future__ import annotations

import time

import numpy as np

from ..simulation.signal_generator import SignalSimulator, SimEvent
from .base import EEGSource, Sample


class SimulatedEEGSource(EEGSource):
    def __init__(
        self,
        fs_hz: float = 256.0,
        total_duration_s: float = 60.0,
        events: list[SimEvent] | None = None,
        seed: int | None = 42,
        realtime: bool = False,
    ):
        """If realtime=True, read_samples() paces itself to wall-clock time
        (useful for the live visualizer); if False, all samples are available
        immediately (useful for tests / batch analysis)."""
        self._fs_hz = fs_hz
        self._realtime = realtime
        sim = SignalSimulator(fs_hz=fs_hz, seed=seed)
        self.recording = sim.render(total_duration_s, events or [])
        self._cursor = 0
        self._n = len(self.recording.timestamps)
        self._start_wall_time: float | None = None
        self._started = False

    def start(self) -> None:
        self._started = True
        self._start_wall_time = time.monotonic()
        self._cursor = 0

    def stop(self) -> None:
        self._started = False

    @property
    def sample_rate_hz(self) -> float:
        return self._fs_hz

    @property
    def has_imu(self) -> bool:
        return True

    def read_samples(self) -> list[Sample]:
        if not self._started:
            return []

        if self._realtime:
            elapsed = time.monotonic() - self._start_wall_time
            target_idx = min(int(elapsed * self._fs_hz), self._n)
        else:
            target_idx = self._n

        rec = self.recording
        out = []
        for i in range(self._cursor, target_idx):
            out.append(
                Sample(
                    timestamp_s=float(rec.timestamps[i]),
                    af7=float(rec.channels["AF7"][i]),
                    af8=float(rec.channels["AF8"][i]),
                    tp9=float(rec.channels["TP9"][i]),
                    tp10=float(rec.channels["TP10"][i]),
                    accel_x=float(rec.accel["x"][i]),
                    accel_y=float(rec.accel["y"][i]),
                    accel_z=float(rec.accel["z"][i]),
                )
            )
        self._cursor = target_idx
        return out
