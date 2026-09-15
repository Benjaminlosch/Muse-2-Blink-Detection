"""Tests for utils/recorder.py CSV recording of labeled runs."""
from __future__ import annotations

import csv

from bcihand.utils.recorder import CSVRecorder, FIELDNAMES, RecordRow


def test_recorder_writes_header_and_rows(tmp_path):
    path = tmp_path / "session.csv"
    with CSVRecorder(path) as recorder:
        recorder.write_row(RecordRow(
            timestamp=0.1, af7=1.0, af8=2.0, tp9=0.5, tp10=0.4,
            filtered_af7=0.9, filtered_af8=1.8, derived_frontal_signal=1.35,
            ground_truth_label="SINGLE_BLINK", predicted_label="SINGLE_BLINK",
            confidence=0.9, final_command="HOLD",
        ))
        recorder.write_row(RecordRow(
            timestamp=0.2, af7=1.1, af8=2.1, tp9=0.5, tp10=0.4,
            filtered_af7=1.0, filtered_af8=1.9, derived_frontal_signal=1.45,
            ground_truth_label="DOUBLE_BLINK", predicted_label="DOUBLE_BLINK",
            confidence=0.95, final_command="OPEN",
        ))

    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        assert reader.fieldnames == FIELDNAMES
        rows = list(reader)

    assert len(rows) == 2
    assert rows[0]["ground_truth_label"] == "SINGLE_BLINK"
    assert rows[1]["final_command"] == "OPEN"


def test_recorder_creates_parent_directories(tmp_path):
    path = tmp_path / "nested" / "dir" / "session.csv"
    with CSVRecorder(path):
        pass
    assert path.exists()


def test_record_row_to_dict_has_all_fieldnames():
    row = RecordRow(
        timestamp=0.0, af7=0.0, af8=0.0, tp9=0.0, tp10=0.0,
        filtered_af7=0.0, filtered_af8=0.0, derived_frontal_signal=0.0,
    )
    assert set(row.to_dict().keys()) == set(FIELDNAMES)
