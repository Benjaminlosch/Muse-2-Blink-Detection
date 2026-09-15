// Portable (no Arduino dependency), sample-by-sample causal DSP for the
// embedded Mode B port (project brief section 20/22). Mirrors
// src/bcihand/dsp/filters.py section-by-section:
//   AdaptiveBaselineTracker -> StreamingSOS (bandpass) -> StreamingSOS (notch)
//
// Coefficients live in dsp_coeffs.h, generated from the exact same
// scipy.signal.butter/iirnotch calls the PC pipeline uses — see
// scripts/generate_esp32_filter_coeffs.py. Nothing here is hand-tuned or
// guessed.
//
// Kept dependency-free (no Arduino.h) so it can be compiled and unit tested
// on a host machine (see test/test_native/) as well as cross-compiled for
// the ESP32 target — WAITING FOR HOST-COMPILER VERIFICATION: no C/C++
// compiler was available in the environment this was written in to
// actually run those native tests (see docs/TESTING.md); this file DOES
// compile successfully as part of the esp32dev PlatformIO build.
#pragma once

#include <cstddef>

namespace bcihand {

// A single Direct Form II Transposed biquad section with persistent state
// (z1, z2), matching scipy.signal.sosfilt's per-section recursion:
//   y[n]  = b0*x[n] + z1
//   z1'   = b1*x[n] - a1*y[n] + z2
//   z2'   = b2*x[n] - a2*y[n]
// (scipy's SOS rows are [b0, b1, b2, a0, a1, a2] with a0 always 1.0, so a0
// is not needed here.)
class BiquadSection {
 public:
  BiquadSection() = default;
  BiquadSection(double b0, double b1, double b2, double a1, double a2);

  double processSample(double x);
  void reset();

 private:
  double b0_ = 1.0, b1_ = 0.0, b2_ = 0.0, a1_ = 0.0, a2_ = 0.0;
  double z1_ = 0.0, z2_ = 0.0;
};

// A cascade of biquad sections (a full SOS filter), built from a
// [n_sections][6] coefficient array as emitted by dsp_coeffs.h.
class StreamingSOS {
 public:
  static constexpr size_t kMaxSections = 4;

  StreamingSOS() = default;
  StreamingSOS(const double sos[][6], size_t n_sections);

  double processSample(double x);
  void reset();

 private:
  BiquadSection sections_[kMaxSections];
  size_t n_sections_ = 0;
};

// Slow exponential-moving-average baseline tracker for DC/drift removal.
// Numerically equivalent to dsp/filters.py's AdaptiveBaselineTracker:
// alpha = dt / (time_constant_s + dt); baseline initializes to the first
// sample (so the first output sample is always exactly 0).
class AdaptiveBaselineTracker {
 public:
  AdaptiveBaselineTracker(double fs_hz, double time_constant_s);

  double processSample(double x);
  void reset();
  double baseline() const { return baseline_; }

 private:
  double alpha_;
  double baseline_ = 0.0;
  bool initialized_ = false;
};

// The full causal per-channel filter chain used in production:
//   adaptive baseline removal -> Butterworth bandpass (SOS) -> optional 60Hz notch (SOS)
// Mirrors dsp/filters.py's CausalBlinkBandFilter. Always uses the fixed
// dsp_coeffs::kFsHz-derived coefficients from dsp_coeffs.h (see that file's
// header comment for how to regenerate if the sample rate or band changes).
class CausalBlinkBandFilter {
 public:
  explicit CausalBlinkBandFilter(double baseline_time_constant_s, bool notch_enabled = true);

  double processSample(double x);
  void reset();

 private:
  AdaptiveBaselineTracker baseline_tracker_;
  StreamingSOS bandpass_;
  StreamingSOS notch_;
  bool notch_enabled_;
};

}  // namespace bcihand
