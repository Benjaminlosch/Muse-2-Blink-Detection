// Lightweight, streaming signal-quality indicators — port of
// detection/signal_quality.py / web/src/core/detection/signalQuality.ts.
#pragma once

#include "adaptive_threshold.h"  // for RingBuffer

namespace bcihand {

struct SignalQualityStatus {
  double quality;  // 0..1, 1 = good
  bool flatline;
  bool railed;
  bool excessiveNoise;
};

class SignalQualityMonitor {
 public:
  explicit SignalQualityMonitor(double fsHz, double windowS = 1.0, double flatlineStdUv = 0.05,
                                  double railedAbsUv = 400.0, double excessiveNoiseStdUv = 150.0);

  SignalQualityStatus update(double rawSampleUv);

 private:
  RingBuffer buf_;
  size_t maxLen_;
  double flatlineStdUv_;
  double railedAbsUv_;
  double excessiveNoiseStdUv_;
};

}  // namespace bcihand
