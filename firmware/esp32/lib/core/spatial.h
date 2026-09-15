// Spatial (multi-channel) combination logic — port of dsp/spatial.py /
// web/src/core/dsp/spatial.ts. Never threshold a single EEG channel alone.
#pragma once

namespace bcihand {

inline double frontalMean(double af7, double af8) { return (af7 + af8) / 2.0; }
inline double frontalDifference(double af7, double af8) { return af7 - af8; }

struct AgreementResult {
  double correlation;
  double amplitudeRatio;
  bool agrees;
};

// windows must be the same length `n`.
AgreementResult checkAf7Af8Agreement(
    const double* af7Window, const double* af8Window, int n,
    double minCorrelation = 0.6, double maxAmplitudeRatio = 3.0);

}  // namespace bcihand
