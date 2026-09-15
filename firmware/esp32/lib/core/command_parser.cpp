#include "command_parser.h"

#include <cstring>

#include "protocol.h"

namespace bcihand {

ParsedFrame parseLine(const char* line) {
  if (line == nullptr || line[0] == '\0') {
    return {FrameKind::kInvalid, Command::kHold};
  }

  if (std::strcmp(line, protocol::kHeartbeat) == 0) {
    return {FrameKind::kHeartbeat, Command::kHold};
  }

  const size_t prefix_len = std::strlen(protocol::kCmdPrefix);
  if (std::strncmp(line, protocol::kCmdPrefix, prefix_len) == 0) {
    const char* payload = line + prefix_len;
    if (std::strcmp(payload, protocol::kCommandOpen) == 0) {
      return {FrameKind::kCommand, Command::kOpen};
    }
    if (std::strcmp(payload, protocol::kCommandClose) == 0) {
      return {FrameKind::kCommand, Command::kClose};
    }
    if (std::strcmp(payload, protocol::kCommandHold) == 0) {
      return {FrameKind::kCommand, Command::kHold};
    }
    return {FrameKind::kInvalid, Command::kHold};  // CMD: prefix but unrecognized payload
  }

  return {FrameKind::kInvalid, Command::kHold};
}

}  // namespace bcihand
