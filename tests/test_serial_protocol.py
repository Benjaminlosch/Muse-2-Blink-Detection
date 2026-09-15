"""Tests for communication/protocol.py and communication/serial_link.py.

Uses a fake in-memory transport (matching the `Transport` Protocol) so comm
health / heartbeat / timeout behavior is fully unit-testable without a
physical ESP32 attached.
"""
from __future__ import annotations

from collections import deque

import pytest

from bcihand.communication import protocol
from bcihand.communication.serial_link import SerialLink


class FakeTransport:
    def __init__(self):
        self.written: list[bytes] = []
        self.incoming: deque[bytes] = deque()
        self.closed = False

    def write(self, data: bytes) -> int:
        self.written.append(data)
        return len(data)

    def readline(self) -> bytes:
        if self.incoming:
            return self.incoming.popleft()
        return b""

    def close(self) -> None:
        self.closed = True

    def queue_incoming(self, line: str) -> None:
        self.incoming.append((line + "\n").encode("ascii"))


class TestProtocolEncoding:
    @pytest.mark.parametrize("cmd", ["OPEN", "CLOSE", "HOLD"])
    def test_encode_valid_commands(self, cmd):
        assert protocol.encode_command(cmd) == f"CMD:{cmd}\n".encode("ascii")

    def test_encode_invalid_command_raises(self):
        with pytest.raises(ValueError):
            protocol.encode_command("EXPLODE")

    def test_encode_heartbeat(self):
        assert protocol.encode_heartbeat() == b"HEARTBEAT\n"

    def test_decode_ack(self):
        assert protocol.decode_line("ACK:OPEN\n") == ("ACK", "OPEN")

    def test_decode_state(self):
        assert protocol.decode_line("STATE:HOLD\n") == ("STATE", "HOLD")

    def test_decode_heartbeat_ack(self):
        assert protocol.decode_line("HB_ACK\n") == ("HB_ACK", "")

    def test_decode_unrecognized_line_returns_none(self):
        assert protocol.decode_line("garbage\n") is None

    def test_decode_empty_line_returns_none(self):
        assert protocol.decode_line("\n") is None
        assert protocol.decode_line("") is None


class TestSerialLink:
    def test_send_command_writes_encoded_frame(self):
        transport = FakeTransport()
        link = SerialLink(transport)
        link.send_command("OPEN")
        assert transport.written[-1] == b"CMD:OPEN\n"

    def test_send_heartbeat_writes_heartbeat_frame(self):
        transport = FakeTransport()
        link = SerialLink(transport)
        link.send_heartbeat()
        assert transport.written[-1] == b"HEARTBEAT\n"

    def test_unhealthy_before_any_ack_received(self):
        transport = FakeTransport()
        link = SerialLink(transport, timeout_s=1.5)
        assert link.is_healthy(now_s=0.0) is False

    def test_becomes_healthy_after_receiving_ack(self):
        transport = FakeTransport()
        link = SerialLink(transport, timeout_s=1.5)
        transport.queue_incoming("ACK:OPEN")
        events = link.poll_incoming()
        assert events == [("ACK", "OPEN")]
        assert link.is_healthy(now_s=0.5) is True

    def test_becomes_unhealthy_after_timeout_elapses(self, monkeypatch):
        transport = FakeTransport()
        link = SerialLink(transport, timeout_s=1.5)

        t = {"now": 100.0}
        monkeypatch.setattr("time.monotonic", lambda: t["now"])

        transport.queue_incoming("HB_ACK")
        link.poll_incoming()
        assert link.is_healthy(now_s=100.5) is True
        assert link.is_healthy(now_s=102.0) is False  # > 1.5s since last ack

    def test_poll_incoming_drains_multiple_queued_lines(self):
        transport = FakeTransport()
        link = SerialLink(transport)
        transport.queue_incoming("ACK:OPEN")
        transport.queue_incoming("STATE:OPEN")
        transport.queue_incoming("HB_ACK")
        events = link.poll_incoming()
        assert events == [("ACK", "OPEN"), ("STATE", "OPEN"), ("HB_ACK", "")]

    def test_unrecognized_incoming_lines_are_ignored(self):
        transport = FakeTransport()
        link = SerialLink(transport)
        transport.queue_incoming("not a real frame")
        events = link.poll_incoming()
        assert events == []
        assert link.is_healthy(now_s=0.0) is False  # unrecognized lines don't count as health

    def test_close_closes_transport(self):
        transport = FakeTransport()
        link = SerialLink(transport)
        link.close()
        assert transport.closed is True
