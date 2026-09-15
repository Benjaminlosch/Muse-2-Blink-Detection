#include "diagnostics.h"

#include <Arduino.h>

#include <cmath>

#include "config.h"
#include "dsp.h"
#include "dsp_golden_vector.h"

namespace bcihand {
namespace diagnostics {

void runDspSelfTest() {
  CausalBlinkBandFilter filter(/*baseline_time_constant_s=*/4.0, /*notch_enabled=*/true);
  double max_abs_diff = 0.0;
  for (int i = 0; i < dsp_golden_vector::kN; ++i) {
    double y = filter.processSample(dsp_golden_vector::kInput[i]);
    double diff = fabs(y - dsp_golden_vector::kExpectedOutput[i]);
    if (diff > max_abs_diff) max_abs_diff = diff;
  }
  bool pass = max_abs_diff <= dsp_golden_vector::kToleranceUv;

  Serial.print("DSP_SELF_TEST:");
  Serial.print(pass ? "PASS" : "FAIL");
  Serial.print(" max_abs_diff_uv=");
  Serial.println(max_abs_diff, 9);
}

void beginStatusLed() {
  pinMode(pins::kStatusLedPin, OUTPUT);
  digitalWrite(pins::kStatusLedPin, LOW);
}

void updateStatusLed(unsigned long now_ms, Command effective_command) {
  switch (effective_command) {
    case Command::kOpen:
      digitalWrite(pins::kStatusLedPin, ((now_ms / 150) % 2 == 0) ? HIGH : LOW);
      break;
    case Command::kClose:
      digitalWrite(pins::kStatusLedPin, ((now_ms / 500) % 2 == 0) ? HIGH : LOW);
      break;
    case Command::kHold:
    default:
      digitalWrite(pins::kStatusLedPin, LOW);
      break;
  }
}

}  // namespace diagnostics
}  // namespace bcihand
