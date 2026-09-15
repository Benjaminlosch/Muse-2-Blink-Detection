"""CSV recording of labeled runs (live or simulated), per project brief section 16.

Valid ground-truth labels (freeform string, but these are the ones the rest
of the tooling — scripts/record_data.py, offline analysis — expect):
    REST, SINGLE_BLINK, DOUBLE_BLINK, NORMAL_BLINK, JAW, HEAD_LEFT, HEAD_RIGHT,
    HEAD_UP, HEAD_DOWN, TALKING, WALKING_OR_MOTION, ELECTRODE_ARTIFACT
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, fields
from pathlib import Path


FIELDNAMES = [
    "timestamp",
    "af7",
    "af8",
    "tp9",
    "tp10",
    "filtered_af7",
    "filtered_af8",
    "derived_frontal_signal",
    "accel_x",
    "accel_y",
    "accel_z",
    "signal_quality",
    "blink_detector_output",
    "ground_truth_label",
    "predicted_label",
    "confidence",
    "final_command",
]


@dataclass
class RecordRow:
    timestamp: float
    af7: float
    af8: float
    tp9: float
    tp10: float
    filtered_af7: float
    filtered_af8: float
    derived_frontal_signal: float
    accel_x: float | None = None
    accel_y: float | None = None
    accel_z: float | None = None
    signal_quality: float | None = None
    blink_detector_output: str = ""
    ground_truth_label: str = ""
    predicted_label: str = ""
    confidence: float | None = None
    final_command: str = ""

    def to_dict(self) -> dict:
        return {f.name: getattr(self, f.name) for f in fields(self)}


class CSVRecorder:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._file = open(self.path, "w", newline="", encoding="utf-8")
        self._writer = csv.DictWriter(self._file, fieldnames=FIELDNAMES)
        self._writer.writeheader()

    def write_row(self, row: RecordRow) -> None:
        self._writer.writerow(row.to_dict())

    def flush(self) -> None:
        self._file.flush()

    def close(self) -> None:
        self._file.close()

    def __enter__(self) -> "CSVRecorder":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()
