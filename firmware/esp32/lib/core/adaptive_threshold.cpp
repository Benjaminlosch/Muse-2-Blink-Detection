#include "adaptive_threshold.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace bcihand {

RingBuffer::RingBuffer(size_t capacity) : capacity_(capacity) {
  data_ = new double[capacity_];
}

RingBuffer::~RingBuffer() { delete[] data_; }

void RingBuffer::push(double value) {
  if (size_ < capacity_) {
    data_[(head_ + size_) % capacity_] = value;
    size_++;
  } else {
    data_[head_] = value;
    head_ = (head_ + 1) % capacity_;
  }
}

void RingBuffer::copyInto(double* out) const {
  for (size_t i = 0; i < size_; i++) {
    out[i] = data_[(head_ + i) % capacity_];
  }
}

namespace {
// Matches numpy.median: average of the two middle elements for an even
// count (not "lower" median / nearest-rank).
double medianOf(double* sortedValues, size_t n) {
  if (n == 0) return 0.0;
  size_t mid = n / 2;
  if (n % 2 == 1) return sortedValues[mid];
  return (sortedValues[mid - 1] + sortedValues[mid]) / 2.0;
}
}  // namespace

AdaptiveThreshold::AdaptiveThreshold(double fsHz, double windowS, double madMultiplier,
                                       int updateIntervalSamples, double minThreshold)
    : buffer_(static_cast<size_t>(std::max(windowS * fsHz, 8.0))),
      madMultiplier_(madMultiplier),
      updateIntervalSamples_(updateIntervalSamples),
      minThreshold_(minThreshold),
      threshold_(minThreshold) {}

double AdaptiveThreshold::update(double absSampleValue, bool inCandidate) {
  if (!inCandidate) {
    buffer_.push(absSampleValue);
    samplesSinceUpdate_ += 1;
  }

  if (samplesSinceUpdate_ >= updateIntervalSamples_ && buffer_.size() >= 8) {
    recompute();
    samplesSinceUpdate_ = 0;
  }

  return threshold_;
}

void AdaptiveThreshold::recompute() {
  size_t n = buffer_.size();
  double* scratch = new double[n];  // infrequent (every updateIntervalSamples_ samples), not per-sample
  buffer_.copyInto(scratch);
  std::sort(scratch, scratch + n);
  medianValue_ = medianOf(scratch, n);

  for (size_t i = 0; i < n; i++) scratch[i] = std::fabs(scratch[i] - medianValue_);
  std::sort(scratch, scratch + n);
  madValue_ = medianOf(scratch, n);

  delete[] scratch;

  threshold_ = std::max(medianValue_ + madMultiplier_ * kMadToSigma * madValue_, minThreshold_);
}

void AdaptiveThreshold::seed(const double* samples, int n) {
  for (int i = 0; i < n; i++) buffer_.push(std::fabs(samples[i]));
  samplesSinceUpdate_ = updateIntervalSamples_;
  update(0.0, /*inCandidate=*/true);  // force recompute without adding a sample
}

}  // namespace bcihand
