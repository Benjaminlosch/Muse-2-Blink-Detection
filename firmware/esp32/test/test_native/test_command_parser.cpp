// Host-side unit tests for lib/core/command_parser.h.
// Run with: pio test -e native
// WAITING FOR HOST-COMPILER VERIFICATION — see docs/TESTING.md and the note
// at the top of test_safety_state_machine.cpp in this directory.
#include <unity.h>

#include "command_parser.h"

using bcihand::Command;
using bcihand::FrameKind;
using bcihand::parseLine;

void setUp() {}
void tearDown() {}

static void test_parses_cmd_open() {
  auto frame = parseLine("CMD:OPEN");
  TEST_ASSERT_TRUE(frame.kind == FrameKind::kCommand);
  TEST_ASSERT_TRUE(frame.command == Command::kOpen);
}

static void test_parses_cmd_close() {
  auto frame = parseLine("CMD:CLOSE");
  TEST_ASSERT_TRUE(frame.kind == FrameKind::kCommand);
  TEST_ASSERT_TRUE(frame.command == Command::kClose);
}

static void test_parses_cmd_hold() {
  auto frame = parseLine("CMD:HOLD");
  TEST_ASSERT_TRUE(frame.kind == FrameKind::kCommand);
  TEST_ASSERT_TRUE(frame.command == Command::kHold);
}

static void test_parses_heartbeat() {
  auto frame = parseLine("HEARTBEAT");
  TEST_ASSERT_TRUE(frame.kind == FrameKind::kHeartbeat);
}

static void test_unrecognized_cmd_payload_is_invalid() {
  auto frame = parseLine("CMD:EXPLODE");
  TEST_ASSERT_TRUE(frame.kind == FrameKind::kInvalid);
}

static void test_garbage_line_is_invalid() {
  auto frame = parseLine("not a real frame");
  TEST_ASSERT_TRUE(frame.kind == FrameKind::kInvalid);
}

static void test_empty_line_is_invalid() {
  auto frame = parseLine("");
  TEST_ASSERT_TRUE(frame.kind == FrameKind::kInvalid);
}

static void test_null_pointer_is_invalid_not_a_crash() {
  auto frame = parseLine(nullptr);
  TEST_ASSERT_TRUE(frame.kind == FrameKind::kInvalid);
}

static void test_case_sensitive_lowercase_command_is_invalid() {
  // The protocol is a strict, case-sensitive ASCII frame format (see
  // include/protocol.h / communication/protocol.py) — silently accepting
  // "cmd:open" would be a spec deviation, not leniency worth having on a
  // safety-critical channel.
  auto frame = parseLine("cmd:open");
  TEST_ASSERT_TRUE(frame.kind == FrameKind::kInvalid);
}

int main(int argc, char** argv) {
  UNITY_BEGIN();
  RUN_TEST(test_parses_cmd_open);
  RUN_TEST(test_parses_cmd_close);
  RUN_TEST(test_parses_cmd_hold);
  RUN_TEST(test_parses_heartbeat);
  RUN_TEST(test_unrecognized_cmd_payload_is_invalid);
  RUN_TEST(test_garbage_line_is_invalid);
  RUN_TEST(test_empty_line_is_invalid);
  RUN_TEST(test_null_pointer_is_invalid_not_a_crash);
  RUN_TEST(test_case_sensitive_lowercase_command_is_invalid);
  return UNITY_END();
}
