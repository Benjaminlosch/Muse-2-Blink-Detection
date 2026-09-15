"""Latency instrumentation for the pipeline stages (project brief section 19).

Usage: call `.mark(stage_name)` at each pipeline stage boundary with a
monotonic timestamp; `LatencyProfiler.summary()` reports per-stage and
total signal-to-command latency statistics.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

STAGES = (
    "acquisition",
    "filtering",
    "candidate_detection",
    "classification",
    "double_blink_confirmation",
    "pc_to_esp32_comm",
)


@dataclass
class LatencyProfiler:
    _durations_s: dict = field(default_factory=lambda: defaultdict(list))

    def record(self, stage: str, duration_s: float) -> None:
        self._durations_s[stage].append(duration_s)

    def record_total(self, duration_s: float) -> None:
        self._durations_s["total_signal_to_command"].append(duration_s)

    def summary(self) -> dict:
        out = {}
        for stage, values in self._durations_s.items():
            if not values:
                continue
            arr = np.asarray(values, dtype=np.float64) * 1000.0  # -> ms
            out[stage] = {
                "n": len(arr),
                "mean_ms": float(np.mean(arr)),
                "median_ms": float(np.median(arr)),
                "p95_ms": float(np.percentile(arr, 95)),
                "max_ms": float(np.max(arr)),
            }
        return out

    def report_text(self) -> str:
        lines = ["Latency profile (ms):"]
        for stage, stats in self.summary().items():
            lines.append(
                f"  {stage:28s} n={stats['n']:5d}  mean={stats['mean_ms']:7.3f}  "
                f"median={stats['median_ms']:7.3f}  p95={stats['p95_ms']:7.3f}  max={stats['max_ms']:7.3f}"
            )
        return "\n".join(lines)
