"""Blink-event -> hand command mapping (configurable, not hard-coded).

Per project brief section 10: command mapping lives in config so it can
change without touching the detector. Today only DOUBLE_BLINK_CONFIRMED maps
to anything (a toggle between OPEN and CLOSE); everything else resolves to
HOLD, the fail-safe state.
"""
from __future__ import annotations

import enum


class Command(enum.Enum):
    OPEN = "OPEN"
    CLOSE = "CLOSE"
    HOLD = "HOLD"


class HandStateTracker:
    """Tracks the last commanded OPEN/CLOSE state so a 'toggle' intent can be
    resolved to a concrete OPEN or CLOSE command. Starts CLOSED-assumed-safe
    is not obviously correct either way for a physical hand, so we start
    UNKNOWN and the first toggle always issues OPEN (an arbitrary but
    deterministic, documented choice — WAITING FOR HARDWARE VERIFICATION to
    confirm this is the desired first-toggle behavior with the real hand)."""

    def __init__(self):
        self._last_commanded: Command | None = None

    @property
    def last_commanded(self) -> Command | None:
        return self._last_commanded

    def toggle(self) -> Command:
        if self._last_commanded == Command.OPEN:
            next_command = Command.CLOSE
        else:
            next_command = Command.OPEN
        self._last_commanded = next_command
        return next_command

    def reset(self) -> None:
        self._last_commanded = None


def resolve_command_mapping(intent: str, mapping: dict, hand_state: HandStateTracker) -> Command:
    """intent: one of 'double_blink', 'single_blink', 'uncertain' (matches
    config.communication.command_mapping keys)."""
    mapped = mapping.get(intent, "HOLD")
    if mapped == "TOGGLE_OPEN_CLOSE":
        return hand_state.toggle()
    if mapped in ("OPEN", "CLOSE"):
        hand_state._last_commanded = Command(mapped)
        return Command(mapped)
    return Command.HOLD
