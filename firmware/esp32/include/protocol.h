// PC <-> ESP32 serial protocol constants. Must stay byte-for-byte in sync
// with src/bcihand/communication/protocol.py — see that file's module
// docstring for the full frame reference:
//
// Frames PC -> ESP32:  CMD:OPEN\n  CMD:CLOSE\n  CMD:HOLD\n  HEARTBEAT\n
// Frames ESP32 -> PC:  ACK:<CMD>\n  STATE:<STATE>\n  HB_ACK\n
#pragma once

namespace bcihand {
namespace protocol {

constexpr const char* kCmdPrefix = "CMD:";
constexpr const char* kAckPrefix = "ACK:";
constexpr const char* kStatePrefix = "STATE:";
constexpr const char* kHeartbeat = "HEARTBEAT";
constexpr const char* kHeartbeatAck = "HB_ACK";

constexpr const char* kCommandOpen = "OPEN";
constexpr const char* kCommandClose = "CLOSE";
constexpr const char* kCommandHold = "HOLD";

}  // namespace protocol
}  // namespace bcihand
