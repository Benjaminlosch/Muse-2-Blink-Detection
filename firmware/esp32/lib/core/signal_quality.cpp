#include "signal_quality.h"

#include <algorithm>
#include <cmath>

namespace bcihand {

SignalQualityMonitor::SignalQualityMonitor(double fsHz, double windowS, double flatlineStdUv,
                                             double railedAbsUv, double excessiveNoiseStdUv)
    : buf_(static_cast<size_t>(std::max(windowS * fsHz, 4.0))),
      maxLen_(static_cast<size_t>(std::max(windowS * fsHz, 4.0))),
      flatlineStdUv_(flatlineStdUv),
      railedAbsUv_(railedAbsUv),
      excessiveNoiseStdUv_(excessiveNoiseStdUv) {}

SignalQualityStatus SignalQualityMonitor::update(double rawSampleUv) {
  buf_.push(rawSampleUv);
  if (buf_.size() < maxLen_) {
    return {0.5, false, false, false};
  }

  size_t n = buf_.size();
  double* values = new double[n];
  buf_.copyInto(values);

  double m = 0;
  for (size_t i = 0; i < n; i++) m += values[i];
  m /= n;

  double sumSq = 0, maxAbs = 0;
  for (size_t i = 0; i < n; i++) {
    sumSq += (values[i] - m) * (values[i] - m);
    maxAbs = std::max(maxAbs, std::fabs(values[i]));
  }
  double stdDev = std::sqrt(sumSq / n);
  delete[] values;

  bool flatline = stdDev < flatlineStdUv_;
  bool railed = maxAbs > railedAbsUv_;
  bool excessiveNoise = stdDev > excessiveNoiseStdUv_;

  double quality;
  if (flatline || railed) quality = 0.0;
  else if (excessiveNoise) quality = 0.2;
  else quality = 1.0;

  return {quality, flatline, railed, excessiveNoise};
}

}  // namespace bcihand
