"""Acquisition abstraction.

Everything downstream (DSP, detection, classification) talks to an
`EEGSource`, never to BrainFlow or the simulator directly. This lets the
acquisition backend be swapped (simulator <-> BrainFlow <-> a future direct
ESP32-BLE bridge for Mode B validation tooling) without touching the DSP or
classifier code, per project brief section 11.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class Sample:
    timestamp_s: float
    af7: float
    af8: float
    tp9: float
    tp10: float
    accel_x: float | None = None
    accel_y: float | None = None
    accel_z: float | None = None


class EEGSource(ABC):
    """Minimal streaming acquisition interface."""

    @abstractmethod
    def start(self) -> None:
        ...

    @abstractmethod
    def read_samples(self) -> list[Sample]:
        """Non-blocking: return whatever new samples are available since the
        last call (possibly empty)."""
        ...

    @abstractmethod
    def stop(self) -> None:
        ...

    @property
    @abstractmethod
    def sample_rate_hz(self) -> float:
        ...

    @property
    def has_imu(self) -> bool:
        return False
