# Muse 2 Setup

**Status: WAITING FOR HARDWARE VERIFICATION.** No physical Muse 2 was
available in the environment this was built in. Everything below describes
what has been implemented against BrainFlow's public, documented API — none
of it has been exercised against a real device.

## Why BrainFlow

Per project brief section 11, acquisition sits behind an `EEGSource`
abstraction (`src/bcihand/acquisition/base.py`) specifically so the backend
can be swapped without touching DSP/detection/classification code.
BrainFlow was chosen as the concrete backend (`acquisition/brainflow_source.py`)
because it is the most actively maintained, cross-platform, open-source
biosignal acquisition library with first-class Muse 2 support (BLE handled
internally by BrainFlow's own board driver), rather than an older
single-purpose Muse BLE tutorial script of uncertain maintenance status.

## Installing

```bash
pip install -e ".[acquisition]"   # adds brainflow as an optional dependency
```

## Usage

```bash
python scripts/run_pipeline.py --source muse2 --serial-port COM3
python scripts/calibrate.py --source muse2
python scripts/record_data.py --source muse2 --label DOUBLE_BLINK --duration 30 --out data/raw/session1.csv
```

`BrainflowMuse2Source` (in `acquisition/brainflow_source.py`) resolves
channel names dynamically via `BoardShim.get_eeg_names(board_id)` rather than
assuming a fixed index ordering — specifically so we do not have to guess
Muse 2's electrode ordering ahead of verification. It also queries the
actual sample rate at runtime via `BoardShim.get_sampling_rate(board_id)`
rather than trusting `config.acquisition.fallback_sample_rate_hz` (256 Hz),
which is only a fallback for contexts where no board is attached (e.g. the
simulator).

## What is assumed vs. verified

| Claim | Status |
|---|---|
| Muse 2 EEG channels are AF7, AF8, TP9, TP10 | From BrainFlow's own `SupportedBoards` documentation, not independently re-verified against a physical device here |
| Muse 2 EEG sample rate is commonly ~256 Hz | Reported in third-party documentation; the code queries the real value at runtime rather than hard-coding it, but that runtime path itself is untested against real hardware |
| Muse 2 IMU/accelerometer available via BrainFlow's `AUXILIARY_PRESET` at ~52 Hz | From BrainFlow documentation; `has_imu` / `get_accel_channels()` usage is implemented defensively (falls back to no IMU on any exception) but untested |
| BLE pairing/connection behavior | Entirely delegated to BrainFlow's own board driver — nothing about Muse 2's BLE protocol is reimplemented or assumed here |

## Troubleshooting (once hardware is available)

This section is intentionally left minimal rather than filled with invented
troubleshooting steps. When testing begins:

1. Confirm `BoardShim.get_sampling_rate(BoardIds.MUSE_2_BOARD)` matches what
   you expect before trusting any derived window-length constant.
2. Confirm `BoardShim.get_eeg_names(...)` actually returns `AF7`/`AF8`/`TP9`/`TP10`
   in some order — `_channel_index()` tries the name as given, uppercased,
   and lowercased, but has never been exercised against real BrainFlow
   output.
3. Record a short REST + deliberate-blink session with
   `scripts/record_data.py --source muse2` and inspect it with
   `scripts/visualize.py` equivalent tooling / `scripts/offline_analysis.py
   --csv` before trusting calibration output.
