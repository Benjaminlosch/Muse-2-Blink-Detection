#include "features.h"

#include <algorithm>
#include <cmath>

#include "spatial.h"

namespace bcihand {

namespace {
double trapz(const double* y, int n, double dx) {
  if (n < 2) return 0.0;
  double sum = (y[0] + y[n - 1]) / 2.0;
  for (int i = 1; i < n - 1; i++) sum += y[i];
  return sum * dx;
}
}  // namespace

BlinkFeatures extractFeatures(const double* frontalWindow, const double* af7Window, const double* af8Window, int n,
                                double fsHz, double baselineLevel, double timeSincePreviousValidBlinkS,
                                double agreementMinCorrelation, double agreementMaxAmplitudeRatio) {
  double dt = 1.0 / fsHz;
  double durationS = (n > 0) ? std::max(n - 1, 0) * dt : 0.0;

  int peakIdx = 0;
  double bestAbs = -1.0;
  for (int i = 0; i < n; i++) {
    double v = std::fabs(frontalWindow[i]);
    if (v > bestAbs) {
      bestAbs = v;
      peakIdx = i;
    }
  }
  double peakAmplitude = (n > 0) ? frontalWindow[peakIdx] : 0.0;
  double absPeakAmplitude = std::fabs(peakAmplitude);

  double positiveExcursion = 0, negativeExcursion = 0;
  if (n > 0) {
    positiveExcursion = frontalWindow[0];
    negativeExcursion = frontalWindow[0];
    for (int i = 1; i < n; i++) {
      if (frontalWindow[i] > positiveExcursion) positiveExcursion = frontalWindow[i];
      if (frontalWindow[i] < negativeExcursion) negativeExcursion = frontalWindow[i];
    }
  }
  double peakToPeakAmplitude = positiveExcursion - negativeExcursion;

  double edgeLevel = (n > 0) ? (frontalWindow[0] + frontalWindow[n - 1]) / 2.0 : 0.0;
  double peakProminence = std::max(absPeakAmplitude - std::fabs(edgeLevel - baselineLevel), 0.0);

  double riseTimeS = 0, fallTimeS = 0, maxSlope = 0, areaUnderCurve = 0;
  double rms = absPeakAmplitude;
  double signalEnergy = (n == 1) ? frontalWindow[0] * frontalWindow[0] : 0.0;

  if (n > 1) {
    riseTimeS = peakIdx * dt;
    fallTimeS = (n - 1 - peakIdx) * dt;
    double maxAbsSlope = 0.0, sumSq = 0.0;
    for (int i = 0; i < n - 1; i++) {
      double slope = std::fabs((frontalWindow[i + 1] - frontalWindow[i]) / dt);
      if (slope > maxAbsSlope) maxAbsSlope = slope;
    }
    maxSlope = maxAbsSlope;

    double* absWindow = new double[n];
    for (int i = 0; i < n; i++) {
      absWindow[i] = std::fabs(frontalWindow[i]);
      sumSq += frontalWindow[i] * frontalWindow[i];
    }
    areaUnderCurve = trapz(absWindow, n, dt);
    delete[] absWindow;

    rms = std::sqrt(sumSq / n);
    signalEnergy = sumSq;
  }

  AgreementResult agreement = checkAf7Af8Agreement(af7Window, af8Window, n, agreementMinCorrelation, agreementMaxAmplitudeRatio);
  double baselineDeviation = edgeLevel - baselineLevel;

  BlinkFeatures f;
  f.peakAmplitude = peakAmplitude;
  f.absPeakAmplitude = absPeakAmplitude;
  f.peakProminence = peakProminence;
  f.positiveExcursion = positiveExcursion;
  f.negativeExcursion = negativeExcursion;
  f.peakToPeakAmplitude = peakToPeakAmplitude;
  f.durationS = durationS;
  f.riseTimeS = riseTimeS;
  f.fallTimeS = fallTimeS;
  f.maxSlope = maxSlope;
  f.areaUnderCurve = areaUnderCurve;
  f.rms = rms;
  f.signalEnergy = signalEnergy;
  f.af7Af8Correlation = agreement.correlation;
  f.af7Af8AmplitudeRatio = agreement.amplitudeRatio;
  f.baselineDeviation = baselineDeviation;
  f.timeSincePreviousValidBlinkS = timeSincePreviousValidBlinkS;
  return f;
}

}  // namespace bcihand
