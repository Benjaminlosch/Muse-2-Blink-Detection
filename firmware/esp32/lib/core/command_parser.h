// Parses one already newline-stripped line of the PC->ESP32 protocol
// (see include/protocol.h) into a typed frame. Deliberately works on plain
// null-terminated C strings (not Arduino's String) so it stays
// dependency-free and host-testable; comms.cpp adapts from Arduino's
// Serial/String API at the boundary.
#pragma once

#include "safety_state_machine.h"

namespace bcihand {

enum class FrameKind { kCommand, kHeartbeat, kInvalid };

struct ParsedFrame {
  FrameKind kind;
  Command command;  // meaningful only when kind == FrameKind::kCommand
};

// `line` must be a null-terminated string with any trailing \r/\n already
// stripped (see comms.cpp's readLine()).
ParsedFrame parseLine(const char* line);

}  // namespace bcihand
