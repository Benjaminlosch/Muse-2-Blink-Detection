// Host-side unit tests for lib/core/safety_state_machine.h.
// Run with: pio test -e native
// WAITING FOR HOST-COMPILER VERIFICATION — see docs/TESTING.md: no C/C++
// host compiler (gcc/g++/MSVC) was available in the environment this was
// written in, so these tests could not actually be executed there. The
// esp32dev target build (which does exercise this same header) has been
// verified to compile successfully in that environment.
#include <unity.h>

#include "safety_state_machine.h"

using bcihand::Command;
using bcihand::SafetyStateMachine;

void setUp() {}
void tearDown() {}

static void test_startup_default_is_hold() {
  SafetyStateMachine safety(1500);
  TEST_ASSERT_TRUE(safety.update(0) == Command::kHold);
}

static void test_never_received_frame_stays_hold_regardless_of_time() {
  SafetyStateMachine safety(1500);
  TEST_ASSERT_TRUE(safety.update(999999) == Command::kHold);
}

static void test_valid_command_is_adopted() {
  SafetyStateMachine safety(1500);
  safety.onCommandReceived(Command::kOpen, 100);
  TEST_ASSERT_TRUE(safety.update(150) == Command::kOpen);
}

static void test_comm_timeout_forces_hold_even_with_recent_open_command() {
  SafetyStateMachine safety(1500);
  safety.onCommandReceived(Command::kOpen, 0);
  TEST_ASSERT_TRUE(safety.update(1000) == Command::kOpen);   // within timeout
  TEST_ASSERT_TRUE(safety.update(1501) == Command::kHold);   // timed out
}

static void test_heartbeat_resets_timeout_without_changing_command() {
  SafetyStateMachine safety(1500);
  safety.onCommandReceived(Command::kOpen, 0);
  safety.onFrameReceived(1000);  // heartbeat at t=1000
  TEST_ASSERT_TRUE(safety.update(2400) == Command::kOpen);  // 1400ms since last frame, still alive
  TEST_ASSERT_TRUE(safety.update(2600) == Command::kHold);  // 1600ms since last frame, timed out
}

static void test_invalid_frame_forces_hold_immediately() {
  SafetyStateMachine safety(1500);
  safety.onCommandReceived(Command::kOpen, 0);
  safety.onInvalidFrameReceived(50);
  TEST_ASSERT_TRUE(safety.update(60) == Command::kHold);
}

static void test_invalid_frame_counts_as_alive_for_timeout_purposes() {
  SafetyStateMachine safety(1500);
  safety.onInvalidFrameReceived(0);
  TEST_ASSERT_FALSE(safety.isCommTimedOut(1000));
}

static void test_hold_command_can_be_explicitly_sent() {
  SafetyStateMachine safety(1500);
  safety.onCommandReceived(Command::kOpen, 0);
  safety.onCommandReceived(Command::kHold, 10);
  TEST_ASSERT_TRUE(safety.update(20) == Command::kHold);
}

int main(int argc, char** argv) {
  UNITY_BEGIN();
  RUN_TEST(test_startup_default_is_hold);
  RUN_TEST(test_never_received_frame_stays_hold_regardless_of_time);
  RUN_TEST(test_valid_command_is_adopted);
  RUN_TEST(test_comm_timeout_forces_hold_even_with_recent_open_command);
  RUN_TEST(test_heartbeat_resets_timeout_without_changing_command);
  RUN_TEST(test_invalid_frame_forces_hold_immediately);
  RUN_TEST(test_invalid_frame_counts_as_alive_for_timeout_purposes);
  RUN_TEST(test_hold_command_can_be_explicitly_sent);
  return UNITY_END();
}
