#include "comms.h"

#include <Arduino.h>

#include "protocol.h"

namespace bcihand {

void Comms::begin(unsigned long baud_rate) { Serial.begin(baud_rate); }

bool Comms::poll(ParsedFrame* out_frame) {
  while (Serial.available() > 0) {
    char c = static_cast<char>(Serial.read());

    if (c == '\n' || c == '\r') {
      if (line_length_ == 0) continue;  // ignore stray/duplicate line terminators
      line_buffer_[line_length_] = '\0';
      *out_frame = parseLine(line_buffer_);
      line_length_ = 0;
      return true;
    }

    if (line_length_ < kLineBufferSize - 1) {
      line_buffer_[line_length_++] = c;
    } else {
      // Overlong line (e.g. line noise with no terminator): drop the
      // partial buffer rather than overflow it. The eventual terminator
      // will produce an empty/garbage line, which parseLine correctly
      // reports as FrameKind::kInvalid.
      line_length_ = 0;
    }
  }
  return false;
}

void Comms::sendAck(const char* command_name) {
  Serial.print(protocol::kAckPrefix);
  Serial.println(command_name);
}

void Comms::sendState(const char* state_name) {
  Serial.print(protocol::kStatePrefix);
  Serial.println(state_name);
}

void Comms::sendHeartbeatAck() { Serial.println(protocol::kHeartbeatAck); }

}  // namespace bcihand
