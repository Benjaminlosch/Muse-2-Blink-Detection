"""PC <-> ESP32 serial protocol (Mode A, USB serial).

Plain-text, newline-terminated, human-readable-over-a-terminal frames — easy
to debug with any serial monitor while this is still being bench-tested.

Frames PC -> ESP32:
    CMD:OPEN\n
    CMD:CLOSE\n
    CMD:HOLD\n
    HEARTBEAT\n

Frames ESP32 -> PC:
    ACK:<CMD>\n      (e.g. "ACK:OPEN")
    STATE:<STATE>\n  (current firmware state, e.g. "STATE:HOLD")
    HB_ACK\n

This exact framing is mirrored in firmware/esp32/src/comms.cpp /
command_parser.cpp — keep the two in sync if you change it. See
docs/ESP32_SETUP.md.
"""
from __future__ import annotations

CMD_PREFIX = "CMD:"
ACK_PREFIX = "ACK:"
STATE_PREFIX = "STATE:"
HEARTBEAT = "HEARTBEAT"
HEARTBEAT_ACK = "HB_ACK"

VALID_COMMANDS = ("OPEN", "CLOSE", "HOLD")


def encode_command(command_name: str) -> bytes:
    if command_name not in VALID_COMMANDS:
        raise ValueError(f"Invalid command: {command_name}")
    return f"{CMD_PREFIX}{command_name}\n".encode("ascii")


def encode_heartbeat() -> bytes:
    return f"{HEARTBEAT}\n".encode("ascii")


def decode_line(line: str) -> tuple[str, str] | None:
    """Returns (kind, payload) for a received line, or None if unrecognized.
    kind is one of: "ACK", "STATE", "HB_ACK"."""
    line = line.strip()
    if not line:
        return None
    if line == HEARTBEAT_ACK:
        return ("HB_ACK", "")
    if line.startswith(ACK_PREFIX):
        return ("ACK", line[len(ACK_PREFIX):])
    if line.startswith(STATE_PREFIX):
        return ("STATE", line[len(STATE_PREFIX):])
    return None
