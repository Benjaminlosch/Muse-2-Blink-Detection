"""PC-side serial transport + comm-health tracking for the ESP32 link.

Comm health (used by the confidence gate to force HOLD on comm loss) is
tracked purely from elapsed time since the last successfully sent frame /
received ack — no assumption that a physical ESP32 is attached, so this is
fully unit-testable with a fake transport (see tests/test_serial_protocol.py).
"""
from __future__ import annotations

import time
from typing import Protocol

from . import protocol


class Transport(Protocol):
    """Minimal transport interface (pyserial's Serial object already satisfies
    this; a fake/mock can too, for tests)."""

    def write(self, data: bytes) -> int: ...
    def readline(self) -> bytes: ...
    def close(self) -> None: ...


class SerialLink:
    def __init__(self, transport: Transport, timeout_s: float = 1.5):
        self.transport = transport
        self.timeout_s = timeout_s
        self._last_ack_time: float | None = None

    @classmethod
    def open_pyserial(cls, port: str, baud_rate: int, timeout_s: float = 1.5) -> "SerialLink":
        import serial  # pyserial; raises a clear ImportError if not installed

        ser = serial.Serial(port=port, baudrate=baud_rate, timeout=0.05)
        return cls(ser, timeout_s=timeout_s)

    def send_command(self, command_name: str) -> None:
        self.transport.write(protocol.encode_command(command_name))

    def send_heartbeat(self) -> None:
        self.transport.write(protocol.encode_heartbeat())

    def poll_incoming(self) -> list[tuple[str, str]]:
        """Drain whatever lines are currently available; updates comm-health
        bookkeeping on any recognized frame. Returns the decoded (kind,
        payload) tuples."""
        events = []
        while True:
            raw = self.transport.readline()
            if not raw:
                break
            try:
                line = raw.decode("ascii", errors="ignore")
            except AttributeError:
                line = str(raw)
            decoded = protocol.decode_line(line)
            if decoded is not None:
                self._last_ack_time = time.monotonic()
                events.append(decoded)
        return events

    def is_healthy(self, now_s: float | None = None) -> bool:
        now_s = now_s if now_s is not None else time.monotonic()
        if self._last_ack_time is None:
            return False
        return (now_s - self._last_ack_time) <= self.timeout_s

    def close(self) -> None:
        self.transport.close()
