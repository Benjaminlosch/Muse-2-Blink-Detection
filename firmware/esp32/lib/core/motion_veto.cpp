#include "motion_veto.h"

#include <algorithm>
#include <cmath>

namespace bcihand {

MotionVetoMonitor::MotionVetoMonitor(double fsHz, double windowS, double energyThresholdG2)
    : capacity_(static_cast<size_t>(std::max(windowS * fsHz, 2.0))),
      energyThresholdG2_(energyThresholdG2) {
  bufX_ = new double[capacity_];
  bufY_ = new double[capacity_];
  bufZ_ = new double[capacity_];
}

MotionVetoMonitor::~MotionVetoMonitor() {
  delete[] bufX_;
  delete[] bufY_;
  delete[] bufZ_;
}

double MotionVetoMonitor::update(bool hasImu, double accelX, double accelY, double accelZ) {
  if (!hasImu) return 0.0;

  size_t writeIdx;
  if (size_ < capacity_) {
    writeIdx = (head_ + size_) % capacity_;
    size_++;
  } else {
    writeIdx = head_;
    head_ = (head_ + 1) % capacity_;
  }
  bufX_[writeIdx] = accelX;
  bufY_[writeIdx] = accelY;
  bufZ_[writeIdx] = accelZ;

  if (size_ < 2) return 0.0;

  double* deviation = new double[size_];
  double m = 0;
  for (size_t i = 0; i < size_; i++) {
    size_t idx = (head_ + i) % capacity_;
    double mag = std::sqrt(bufX_[idx] * bufX_[idx] + bufY_[idx] * bufY_[idx] + bufZ_[idx] * bufZ_[idx]);
    deviation[i] = mag - 1.0;
    m += deviation[i];
  }
  m /= size_;

  double sumSq = 0;
  for (size_t i = 0; i < size_; i++) sumSq += (deviation[i] - m) * (deviation[i] - m);
  delete[] deviation;

  return sumSq / size_;
}

}  // namespace bcihand
