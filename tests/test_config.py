"""Tests for utils/config.py — YAML loading, attribute access, and the
calibration-override deep-merge used by config/calibration_active.yaml."""
from __future__ import annotations

import pytest
import yaml

from bcihand.utils.config import ConfigNode, apply_overrides, load_config


def test_default_config_loads_and_exposes_nested_attributes(config):
    assert config.dsp.highpass_hz == pytest.approx(0.5)
    assert config.dsp.lowpass_hz == pytest.approx(20.0)
    assert config.safety.startup_state == "HOLD"
    assert config.safety.on_uncertain == "HOLD"
    assert config.safety.on_comm_timeout == "HOLD"


def test_config_node_get_with_default_for_missing_key(config):
    assert config.dsp.get("nonexistent_key", "fallback") == "fallback"
    assert config.get("nonexistent_top_level", None) is None


def test_config_node_contains():
    node = ConfigNode({"a": 1, "b": {"c": 2}})
    assert "a" in node
    assert "z" not in node


def test_config_node_missing_attribute_raises():
    node = ConfigNode({"a": 1})
    with pytest.raises(AttributeError):
        _ = node.nonexistent


def test_config_node_to_dict_round_trips():
    data = {"a": 1, "b": {"c": 2}}
    node = ConfigNode(data)
    assert node.to_dict() == data


def test_load_config_without_override_ignores_missing_file(tmp_path):
    default_path = tmp_path / "default.yaml"
    default_path.write_text(yaml.safe_dump({"dsp": {"highpass_hz": 1.0}}), encoding="utf-8")
    cfg = load_config(default_path=default_path, override_path=tmp_path / "does_not_exist.yaml")
    assert cfg.dsp.highpass_hz == 1.0


def test_load_config_deep_merges_calibration_override(tmp_path):
    default_path = tmp_path / "default.yaml"
    override_path = tmp_path / "calibration_active.yaml"
    default_path.write_text(
        yaml.safe_dump({"dsp": {"highpass_hz": 0.5, "lowpass_hz": 20.0}, "safety": {"startup_state": "HOLD"}}),
        encoding="utf-8",
    )
    override_path.write_text(
        yaml.safe_dump({"dsp": {"highpass_hz": 0.8}}),  # only overrides one nested key
        encoding="utf-8",
    )
    cfg = load_config(default_path=default_path, override_path=override_path)
    assert cfg.dsp.highpass_hz == 0.8       # overridden
    assert cfg.dsp.lowpass_hz == 20.0       # preserved from default (deep merge, not replace)
    assert cfg.safety.startup_state == "HOLD"  # untouched section preserved


def test_apply_overrides_merges_in_memory_without_touching_disk(config):
    updated = apply_overrides(config, {"dsp": {"highpass_hz": 5.0}})
    assert updated.dsp.highpass_hz == 5.0
    assert updated.dsp.lowpass_hz == config.dsp.lowpass_hz  # untouched sibling key preserved
    assert config.dsp.highpass_hz == pytest.approx(0.5)  # original untouched


def test_load_config_default_override_path_next_to_default(tmp_path):
    default_path = tmp_path / "default_config.yaml"
    default_path.write_text(yaml.safe_dump({"dsp": {"highpass_hz": 0.5}}), encoding="utf-8")
    (tmp_path / "calibration_active.yaml").write_text(
        yaml.safe_dump({"dsp": {"highpass_hz": 0.9}}), encoding="utf-8"
    )
    cfg = load_config(default_path=default_path)  # override_path defaults to sibling file
    assert cfg.dsp.highpass_hz == 0.9
