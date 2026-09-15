"""Regression test for acquisition.primary_channels (pipeline.py's
_channel_value indirection) — added after discovering on real Muse 2
hardware that TP9/TP10 (ear-clip electrodes) can show a much cleaner blink
signal than AF7/AF8 (forehead electrodes) depending on skin contact, and
making the detection channel pair a per-user config choice instead of a
pipeline.py-hardcoded assumption. See docs/CALIBRATION.md "Channel
selection".
"""
from __future__ import annotations

import pytest

from bcihand.acquisition.simulated_source import SimulatedEEGSource
from bcihand.classification.state_machine import BlinkEventType
from bcihand.pipeline import BlinkPipeline
from bcihand.simulation.signal_generator import SimEvent
from bcihand.utils.config import apply_overrides, load_config

FS = 256.0


def _double_blink_samples():
    # A single genuine double blink, well clear of any edge effects.
    events = [SimEvent("double_blink", onset_s=2.0, duration_s=0.58, params={"amplitude_uv": 95, "gap_s": 0.22})]
    source = SimulatedEEGSource(fs_hz=FS, total_duration_s=6.0, events=events, seed=7)
    source.start()
    return source.read_samples()


def test_default_primary_channels_is_af7_af8():
    config = load_config(override_path=False)
    assert list(config.acquisition.primary_channels) == ["AF7", "AF8"]


def test_primary_channels_config_actually_redirects_which_data_feeds_detection():
    """The signal generator always writes the full simulated blink pulse to
    AF7/AF8 and only a weak (0.15x) volume-conducted remnant to TP9/TP10
    (see simulation/signal_generator.py::_add_blink_pulse). So the exact
    same simulated samples must produce a confirmed double blink when the
    pipeline is configured for AF7/AF8, and must NOT when configured for
    TP9/TP10 (where the remnant amplitude falls under min_prominence_uv) —
    proving this config value actually changes which Sample fields are
    read, rather than being dead configuration.
    """
    config = load_config(override_path=False)
    samples = _double_blink_samples()

    af7_af8_pipeline = BlinkPipeline(config, fs_hz=FS)
    af7_af8_results = [af7_af8_pipeline.process_sample(s) for s in samples]
    af7_af8_doubles = [
        r for r in af7_af8_results if r.state_event is not None and r.state_event.event_type == BlinkEventType.DOUBLE_BLINK_CONFIRMED
    ]
    assert len(af7_af8_doubles) == 1, "Expected the genuine double blink to be detected on AF7/AF8 (full amplitude)"

    tp9_tp10_config = apply_overrides(config, {"acquisition": {"primary_channels": ["TP9", "TP10"]}})
    tp9_tp10_pipeline = BlinkPipeline(tp9_tp10_config, fs_hz=FS)
    tp9_tp10_results = [tp9_tp10_pipeline.process_sample(s) for s in samples]
    tp9_tp10_doubles = [
        r for r in tp9_tp10_results if r.state_event is not None and r.state_event.event_type == BlinkEventType.DOUBLE_BLINK_CONFIRMED
    ]
    assert len(tp9_tp10_doubles) == 0, (
        "The same samples' TP9/TP10 fields only carry a weak volume-conducted remnant in this simulated "
        "scenario, under min_prominence_uv — if this fires, primary_channels is not actually being read"
    )


def test_primary_channels_rejects_wrong_length():
    config = load_config(override_path=False)
    bad_config = apply_overrides(config, {"acquisition": {"primary_channels": ["AF7"]}})
    with pytest.raises(ValueError):
        BlinkPipeline(bad_config, fs_hz=FS)


def test_primary_channels_rejects_unknown_channel_name():
    config = load_config(override_path=False)
    bad_config = apply_overrides(config, {"acquisition": {"primary_channels": ["AF7", "FPZ"]}})
    with pytest.raises(ValueError):
        BlinkPipeline(bad_config, fs_hz=FS)
