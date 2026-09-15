#include "dsp.h"

#include "dsp_coeffs.h"

namespace bcihand {

BiquadSection::BiquadSection(double b0, double b1, double b2, double a1, double a2)
    : b0_(b0), b1_(b1), b2_(b2), a1_(a1), a2_(a2) {}

double BiquadSection::processSample(double x) {
  double y = b0_ * x + z1_;
  z1_ = b1_ * x - a1_ * y + z2_;
  z2_ = b2_ * x - a2_ * y;
  return y;
}

void BiquadSection::reset() {
  z1_ = 0.0;
  z2_ = 0.0;
}

StreamingSOS::StreamingSOS(const double sos[][6], size_t n_sections) : n_sections_(n_sections) {
  if (n_sections_ > kMaxSections) {
    n_sections_ = kMaxSections;  // defensive clamp; dsp_coeffs.h never exceeds this in practice
  }
  for (size_t i = 0; i < n_sections_; ++i) {
    // sos[i] = [b0, b1, b2, a0, a1, a2]; a0 is always 1.0 in scipy's SOS output.
    sections_[i] = BiquadSection(sos[i][0], sos[i][1], sos[i][2], sos[i][4], sos[i][5]);
  }
}

double StreamingSOS::processSample(double x) {
  double y = x;
  for (size_t i = 0; i < n_sections_; ++i) {
    y = sections_[i].processSample(y);
  }
  return y;
}

void StreamingSOS::reset() {
  for (size_t i = 0; i < n_sections_; ++i) {
    sections_[i].reset();
  }
}

AdaptiveBaselineTracker::AdaptiveBaselineTracker(double fs_hz, double time_constant_s) {
  double dt = 1.0 / fs_hz;
  alpha_ = dt / (time_constant_s + dt);
}

double AdaptiveBaselineTracker::processSample(double x) {
  if (!initialized_) {
    baseline_ = x;
    initialized_ = true;
  } else {
    baseline_ = baseline_ + alpha_ * (x - baseline_);
  }
  return x - baseline_;
}

void AdaptiveBaselineTracker::reset() {
  baseline_ = 0.0;
  initialized_ = false;
}

CausalBlinkBandFilter::CausalBlinkBandFilter(double baseline_time_constant_s, bool notch_enabled)
    : baseline_tracker_(dsp_coeffs::kFsHz, baseline_time_constant_s),
      bandpass_(dsp_coeffs::kBandpassSOS, 2),
      notch_(dsp_coeffs::kNotchSOS, 1),
      notch_enabled_(notch_enabled) {}

double CausalBlinkBandFilter::processSample(double x) {
  double y = baseline_tracker_.processSample(x);
  y = bandpass_.processSample(y);
  if (notch_enabled_) {
    y = notch_.processSample(y);
  }
  return y;
}

void CausalBlinkBandFilter::reset() {
  baseline_tracker_.reset();
  bandpass_.reset();
  notch_.reset();
}

}  // namespace bcihand
