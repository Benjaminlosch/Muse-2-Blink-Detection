#include "spatial.h"

#include <algorithm>
#include <cmath>

namespace bcihand {

namespace {
double mean(const double* x, int n) {
  double s = 0;
  for (int i = 0; i < n; i++) s += x[i];
  return s / n;
}

double pearsonCorrelation(const double* a, const double* b, int n) {
  double ma = mean(a, n), mb = mean(b, n);
  double cov = 0, varA = 0, varB = 0;
  for (int i = 0; i < n; i++) {
    double da = a[i] - ma, db = b[i] - mb;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  double denom = std::sqrt(varA * varB);
  if (denom < 1e-18) return 0.0;
  return cov / denom;
}

double stddev(const double* x, int n, double m) {
  double s = 0;
  for (int i = 0; i < n; i++) s += (x[i] - m) * (x[i] - m);
  return std::sqrt(s / n);
}
}  // namespace

AgreementResult checkAf7Af8Agreement(const double* af7Window, const double* af8Window, int n,
                                      double minCorrelation, double maxAmplitudeRatio) {
  if (n < 2) return {0.0, INFINITY, false};

  double m7 = mean(af7Window, n), m8 = mean(af8Window, n);
  double s7 = stddev(af7Window, n, m7), s8 = stddev(af8Window, n, m8);

  double correlation = 0.0;
  if (s7 >= 1e-9 && s8 >= 1e-9) {
    correlation = pearsonCorrelation(af7Window, af8Window, n);
    if (std::isnan(correlation)) correlation = 0.0;
  }

  double amp7 = 0, amp8 = 0;
  for (int i = 0; i < n; i++) {
    amp7 = std::max(amp7, std::fabs(af7Window[i]));
    amp8 = std::max(amp8, std::fabs(af8Window[i]));
  }
  double lo = std::min(amp7, amp8), hi = std::max(amp7, amp8);
  double amplitudeRatio = (lo > 1e-9) ? (hi / lo) : INFINITY;

  bool agrees = (correlation >= minCorrelation) && (amplitudeRatio <= maxAmplitudeRatio);
  return {correlation, amplitudeRatio, agrees};
}

}  // namespace bcihand
