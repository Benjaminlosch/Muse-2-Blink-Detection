"""Tests for utils/latency.py latency instrumentation (project brief section 19)."""
from __future__ import annotations

from bcihand.utils.latency import LatencyProfiler


def test_summary_computes_ms_statistics():
    profiler = LatencyProfiler()
    for d in (0.001, 0.002, 0.003, 0.004):  # seconds
        profiler.record("filtering", d)
    summary = profiler.summary()
    assert summary["filtering"]["n"] == 4
    assert summary["filtering"]["mean_ms"] == 2.5
    assert summary["filtering"]["max_ms"] == 4.0


def test_record_total_uses_dedicated_key():
    profiler = LatencyProfiler()
    profiler.record_total(0.01)
    summary = profiler.summary()
    assert "total_signal_to_command" in summary
    assert summary["total_signal_to_command"]["n"] == 1


def test_empty_stage_omitted_from_summary():
    profiler = LatencyProfiler()
    assert profiler.summary() == {}


def test_report_text_contains_stage_names():
    profiler = LatencyProfiler()
    profiler.record("classification", 0.005)
    text = profiler.report_text()
    assert "classification" in text
    assert "mean=" in text
