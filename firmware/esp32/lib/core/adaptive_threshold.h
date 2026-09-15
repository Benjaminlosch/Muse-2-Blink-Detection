// Robust, adaptive amplitude threshold — port of detection/adaptive_threshold.py
// / web/src/core/detection/adaptiveThreshold.ts. Median/MAD, not mean/std:
// robust to the very outliers being thresholded against.
//
// Embedded note: this recomputes an exact median/MAD over the rolling
// buffer via a full sort every `updateIntervalSamples` — O(n log n), same
// approach as the Python/TS ports use (a correctness baseline first). The
// buffer itself is a single fixed-capacity allocation made once at
// construction (never resized/reallocated per sample) specifically to
// avoid heap fragmentation on a device meant to run for hours/days.
#pragma once

#include <cstddef>

namespace bcihand {

constexpr double kMadToSigma = 1.4826;

// Fixed-capacity circular buffer, allocated once. Mirrors Python's
// collections.deque(maxlen=...) / the TS RingBuffer.
class RingBuffer {
 public:
  explicit RingBuffer(size_t capacity);
  ~RingBuffer();
  RingBuffer(const RingBuffer&) = delete;
  RingBuffer& operator=(const RingBuffer&) = delete;

  void push(double value);
  size_t size() const { return size_; }
  size_t capacity() const { return capacity_; }
  // Copies the buffer's current contents (in insertion order) into `out`,
  // which must have room for at least size() elements. Used only when a
  // recompute is due (infrequent), not per-sample.
  void copyInto(double* out) const;

 private:
  double* data_;
  size_t capacity_;
  size_t size_ = 0;
  size_t head_ = 0;  // index of the oldest element
};

class AdaptiveThreshold {
 public:
  AdaptiveThreshold(double fsHz, double windowS = 10.0, double madMultiplier = 4.0,
                     int updateIntervalSamples = 32, double minThreshold = 1e-6);

  // Feed one (rectified/abs) filtered sample; returns the current threshold.
  double update(double absSampleValue, bool inCandidate = false);

  double threshold() const { return threshold_; }
  double noiseFloorMedian() const { return medianValue_; }
  double noiseFloorMad() const { return madValue_; }

  // Bulk-seed the buffer (e.g. right after calibration) so the threshold
  // is meaningful immediately instead of ramping up from zero.
  void seed(const double* samples, int n);

 private:
  RingBuffer buffer_;
  double madMultiplier_;
  int updateIntervalSamples_;
  double minThreshold_;
  int samplesSinceUpdate_ = 0;
  double medianValue_ = 0.0;
  double madValue_ = 0.0;
  double threshold_;

  void recompute();
};

}  // namespace bcihand
