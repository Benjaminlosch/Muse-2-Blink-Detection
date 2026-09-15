// IMU-based motion-artifact veto (optional, configurable) — port of
// detection/motion_veto.py / web/src/core/detection/motionVeto.ts.
#pragma once

#include <cstddef>

namespace bcihand {

class MotionVetoMonitor {
 public:
  explicit MotionVetoMonitor(double fsHz, double windowS = 0.5, double energyThresholdG2 = 0.05);
  ~MotionVetoMonitor();
  MotionVetoMonitor(const MotionVetoMonitor&) = delete;
  MotionVetoMonitor& operator=(const MotionVetoMonitor&) = delete;

  // Feed one IMU sample. Returns the current motion-energy estimate
  // (variance of deviation from 1g, in g^2). hasImu=false (no data this
  // cycle) returns 0.
  double update(bool hasImu, double accelX, double accelY, double accelZ);

  bool isMotionArtifact(double motionEnergyG2) const { return motionEnergyG2 > energyThresholdG2_; }

 private:
  double* bufX_;
  double* bufY_;
  double* bufZ_;
  size_t capacity_;
  size_t size_ = 0;
  size_t head_ = 0;
  double energyThresholdG2_;
};

}  // namespace bcihand
