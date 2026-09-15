"""Tests for detection/motion_veto.py IMU-based motion-artifact veto."""
from __future__ import annotations

from bcihand.detection.motion_veto import MotionVetoMonitor

FS = 256.0


def test_missing_imu_data_returns_zero_energy():
    monitor = MotionVetoMonitor(FS)
    energy = monitor.update(None, None, None)
    assert energy == 0.0
    assert monitor.is_motion_artifact(energy) is False


def test_resting_at_1g_reports_low_energy():
    monitor = MotionVetoMonitor(FS, energy_threshold_g2=0.05)
    energy = 0.0
    for _ in range(50):
        energy = monitor.update(0.0, 0.0, 1.0)
    assert energy < 0.05
    assert monitor.is_motion_artifact(energy) is False


def test_large_head_acceleration_trips_veto():
    monitor = MotionVetoMonitor(FS, energy_threshold_g2=0.05)
    energy = 0.0
    for i in range(50):
        # Oscillate the acceleration magnitude strongly around 1g to simulate
        # vigorous head motion (varying z, not just flipping x's sign, since
        # ||(x, 0, 1)|| is identical for +x and -x and would produce zero
        # variance).
        z = 1.9 if i % 2 == 0 else 0.1
        energy = monitor.update(0.0, 0.0, z)
    assert energy > 0.05
    assert monitor.is_motion_artifact(energy) is True


def test_disabled_via_config_is_caller_responsibility():
    # MotionVetoMonitor itself has no "enabled" flag; the pipeline checks
    # config.motion_veto.enabled before consulting is_motion_artifact(). This
    # test documents that the monitor always computes energy regardless.
    monitor = MotionVetoMonitor(FS)
    assert monitor.update(0.0, 0.0, 1.0) == 0.0
