// Cheap, streaming-friendly feature extraction — port of
// detection/features.py / web/src/core/detection/features.ts.
#pragma once

namespace bcihand {

struct BlinkFeatures {
  double peakAmplitude;
  double absPeakAmplitude;
  double peakProminence;
  double positiveExcursion;
  double negativeExcursion;
  double peakToPeakAmplitude;
  double durationS;
  double riseTimeS;
  double fallTimeS;
  double maxSlope;
  double areaUnderCurve;
  double rms;
  double signalEnergy;
  double af7Af8Correlation;
  double af7Af8AmplitudeRatio;
  double baselineDeviation;
  double timeSincePreviousValidBlinkS;
};

BlinkFeatures extractFeatures(const double* frontalWindow, const double* af7Window, const double* af8Window, int n,
                                double fsHz, double baselineLevel, double timeSincePreviousValidBlinkS,
                                double agreementMinCorrelation = 0.6, double agreementMaxAmplitudeRatio = 3.0);

}  // namespace bcihand
