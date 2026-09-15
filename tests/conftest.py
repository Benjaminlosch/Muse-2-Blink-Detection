"""Shared pytest fixtures for the bcihand test suite.

All tests run against config/default_config.yaml with any local
config/calibration_active.yaml override explicitly excluded, so test
behavior never depends on a machine-local calibration file.
"""
from __future__ import annotations

import pytest

from bcihand.utils.config import load_config

DEFAULT_FS_HZ = 256.0


@pytest.fixture
def config():
    return load_config(override_path=False)


@pytest.fixture
def fs_hz():
    return DEFAULT_FS_HZ
