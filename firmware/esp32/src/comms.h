// Thin Arduino Serial adapter: buffers incoming bytes into newline-
// terminated lines and hands them to command_parser.h; sends ACK/STATE/
// HB_ACK frames. Kept separate from command_parser.h/.cpp so the actual
// parsing logic stays dependency-free and host-testable.
#pragma once

#include <cstddef>

#include "command_parser.h"

namespace bcihand {

class Comms {
 public:
  void begin(unsigned long baud_rate);

  // Drains whatever bytes are currently available. Returns true and fills
  // `out_frame` if a complete line was assembled; call in a loop
  // (`while (comms.poll(&frame))`) to drain multiple queued frames per
  // loop() iteration. Returns false once no more complete lines remain.
  bool poll(ParsedFrame* out_frame);

  void sendAck(const char* command_name);
  void sendState(const char* state_name);
  void sendHeartbeatAck();

 private:
  static constexpr size_t kLineBufferSize = 64;
  char line_buffer_[kLineBufferSize];
  size_t line_length_ = 0;
};

}  // namespace bcihand
