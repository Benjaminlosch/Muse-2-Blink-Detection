"""Configuration loading and merging.

All tunable constants live in YAML (config/default_config.yaml). This module
loads that file into a nested, attribute-accessible, read-only structure and
supports merging in a calibration-derived override file
(config/calibration_active.yaml) produced by the calibration routine.
"""
from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Mapping

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG_PATH = REPO_ROOT / "config" / "default_config.yaml"


class ConfigNode:
    """Read-only, attribute-accessible view over a nested dict."""

    def __init__(self, data: Mapping[str, Any]):
        object.__setattr__(self, "_data", dict(data))

    def __getattr__(self, name: str) -> Any:
        try:
            value = self._data[name]
        except KeyError as exc:
            raise AttributeError(f"No config key '{name}'") from exc
        if isinstance(value, Mapping):
            return ConfigNode(value)
        return value

    def __getitem__(self, name: str) -> Any:
        return getattr(self, name)

    def __contains__(self, name: str) -> bool:
        return name in self._data

    def __repr__(self) -> str:
        return f"ConfigNode({self._data!r})"

    def to_dict(self) -> dict:
        return copy.deepcopy(self._data)

    def get(self, name: str, default: Any = None) -> Any:
        if name in self._data:
            return getattr(self, name)
        return default


def _deep_merge(base: dict, override: Mapping[str, Any]) -> dict:
    merged = copy.deepcopy(base)
    for key, value in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, Mapping):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def apply_overrides(config: ConfigNode, overrides: Mapping[str, Any]) -> ConfigNode:
    """Deep-merge `overrides` on top of an already-loaded ConfigNode, in
    memory, without touching disk. Used by scripts/calibrate.py to preview
    (and self-check) calibration-derived overrides before writing them to
    config/calibration_active.yaml."""
    return ConfigNode(_deep_merge(config.to_dict(), overrides))


def load_config(
    default_path: Path | str = DEFAULT_CONFIG_PATH,
    override_path: Path | str | None = None,
) -> ConfigNode:
    """Load default_config.yaml, optionally deep-merged with a calibration override.

    override_path defaults to config/calibration_active.yaml next to the default
    config if that file exists; pass override_path=False (or a nonexistent path)
    to load defaults only.
    """
    default_path = Path(default_path)
    with open(default_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    if override_path is None:
        override_path = default_path.parent / "calibration_active.yaml"
    if override_path and Path(override_path).exists():
        with open(override_path, "r", encoding="utf-8") as f:
            override_data = yaml.safe_load(f) or {}
        data = _deep_merge(data, override_data)

    return ConfigNode(data)
