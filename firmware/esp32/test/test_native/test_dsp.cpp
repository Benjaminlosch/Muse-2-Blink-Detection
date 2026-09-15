// Host-side numeric cross-check of the embedded DSP port against the
// golden vector generated from the Python production filter (project brief
// section 20). Run with: pio test -e native
// WAITING FOR HOST-COMPILER VERIFICATION — see docs/TESTING.md and the note
// at the top of test_safety_state_machine.cpp in this directory. The same
// comparison runs on real hardware at boot via diagnostics.cpp's
// runDspSelfTest() (src/diagnostics.cpp), which only requires the ESP32
// toolchain (already verified to compile) rather than a host compiler.
#include <unity.h>

#include <cmath>

#include "dsp.h"
#include "dsp_golden_vector.h"

using bcihand::CausalBlinkBandFilter;

void setUp() {}
void tearDown() {}

static void test_causal_filter_matches_python_golden_vector() {
  CausalBlinkBandFilter filter(/*baseline_time_constant_s=*/4.0, /*notch_enabled=*/true);
  double max_abs_diff = 0.0;
  for (int i = 0; i < bcihand::dsp_golden_vector::kN; ++i) {
    double y = filter.processSample(bcihand::dsp_golden_vector::kInput[i]);
    double diff = std::fabs(y - bcihand::dsp_golden_vector::kExpectedOutput[i]);
    if (diff > max_abs_diff) max_abs_diff = diff;
  }
  TEST_ASSERT_TRUE(max_abs_diff <= bcihand::dsp_golden_vector::kToleranceUv);
}

static void test_reset_clears_filter_state() {
  CausalBlinkBandFilter filter(4.0, true);
  for (int i = 0; i < 100; ++i) filter.processSample(200.0);
  filter.reset();
  // Immediately after reset, the baseline tracker re-initializes to the
  // first new sample, so the first output is exactly 0 again.
  double y = filter.processSample(50.0);
  TEST_ASSERT_DOUBLE_WITHIN(1e-9, 0.0, y);
}

int main(int argc, char** argv) {
  UNITY_BEGIN();
  RUN_TEST(test_causal_filter_matches_python_golden_vector);
  RUN_TEST(test_reset_clears_filter_state);
  return UNITY_END();
}
