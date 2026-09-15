# Testing

## PC / Python (`tests/`)

```bash
pip install -e ".[dev]"
pytest
```

148 tests, all running against simulated data and hand-constructed fixtures
— none require physical hardware. Coverage includes:

| Area | File(s) |
|---|---|
| Causal filters (DC/drift rejection, 60Hz notch, streaming = block) | `test_filters.py` |
| Spatial combination / AF7-AF8 agreement | `test_spatial.py` |
| Candidate detector (width bounds, rebound rejection, refractory, truncation) | `test_candidate_detector.py` |
| Adaptive median/MAD threshold | `test_adaptive_threshold.py` |
| Feature extraction | `test_features.py` |
| Signal quality (flatline/railed/noise) | `test_signal_quality.py` |
| Motion veto | `test_motion_veto.py` |
| Calibration (incl. the ringing/self-check regressions — see CALIBRATION.md) | `test_calibration.py` |
| Rule-based classifier (every hard gate) | `test_classifier.py` |
| Double-blink state machine (timing, debounce, refractory) | `test_state_machine.py` |
| Confidence/safety gate | `test_confidence_gate.py` |
| Command mapping | `test_command_mapper.py` |
| Serial protocol + comm health | `test_serial_protocol.py` |
| Config loading/merging | `test_config.py` |
| CSV recorder | `test_recorder.py` |
| Latency profiler | `test_latency.py` |
| Offline analysis metrics | `test_analysis_metrics.py` |
| Signal simulator | `test_signal_generator.py` |
| **Full end-to-end simulation (the most important file)** | `test_end_to_end_simulation.py` |

`test_end_to_end_simulation.py` runs the built-in "one of everything" demo
scenario (two genuine double blinks plus every artifact type the project
cares about rejecting) through the *actual* `BlinkPipeline`, and asserts the
core safety property: exactly the two genuine double blinks produce
`OPEN`/`CLOSE`, and nothing else — no jaw clench, muscle burst, head motion,
baseline drift, 60Hz interference, electrode dropout, single-channel
artifact, oversized transient, random spike, or slow blink — ever produces a
non-`HOLD` command. This is the test to run first after touching detection or
classification code.

## Web app (`web/`)

```bash
cd web
npm install
npm run test        # vitest — 19 tests
npm run typecheck   # tsc -b --noEmit
npm run build         # production build, also run in CI before deploy
```

19 vitest tests, all running in Node (no browser, no hardware required):

| Area | File(s) |
|---|---|
| Causal filter vs. Python golden vector | `core/dsp/filters.test.ts` |
| **Full pipeline vs. Python golden run (the most important file)** | `core/pipeline.test.ts` |
| Calibration statistics (ringing exclusion, self-check regressions) | `core/detection/calibration.test.ts` |
| ESP32 serial protocol encode/decode | `esp32/protocol.test.ts` |

See [WEB_DSP_EQUIVALENCE.md](WEB_DSP_EQUIVALENCE.md) for how
`pipeline.test.ts` works and the real divergence bug it caught during
development (a config key-naming mismatch that silently forced every
double blink to `HOLD`) — this is the test to run first after touching
anything in `web/src/core/`.

**Also verified live in a real browser**, not just unit tests: using
Playwright against the Vite dev server, the full demo scenario was run
through Simulation Mode end-to-end with zero console errors, and the Live
EEG, Blink Detector, and Double Blink pages were confirmed to show the
actual blink waveforms, candidate/rejection statistics (including
`filter_rebound_bounce` rejections), and a `DOUBLE_BLINK_CONFIRMED` event
at the same timestamp/confidence/command Python produces for the same
scenario. This was a one-time manual verification during development, not
an automated CI step — the repository does not currently include a
Playwright/browser-driven test suite (a reasonable next addition, not yet
built).

## ESP32 firmware (`firmware/esp32/`)

### What has been verified in this environment

- **Both firmware environments compile** against the real ESP32 toolchain
  (PlatformIO + `espressif32` platform + `arduino-esp32` framework),
  installed and verified here: `pio run -e esp32dev` (Mode A, both
  `MOTOR_MODE_DC_HBRIDGE` and `MOTOR_MODE_SERVO`) and
  `pio run -e esp32dev_standalone` (Mode B) both succeed.
- **`esp32dev_standalone` links against real NimBLE-Arduino with zero
  errors** — the full BLE central client (`src/muse_ble_client.cpp`) and
  the complete detection/classification pipeline port
  (`lib/core/blink_pipeline.cpp` and its dependencies) compile and link
  cleanly. 11.7% RAM / 48.1% flash used per the build's own reporting.
- **The generated-config drop-in workflow was verified end-to-end**: the
  web app's `generatePipelineConfigHeader()` output was substituted for
  `firmware/esp32/lib/core/pipeline_config.h` and the standalone
  environment rebuilt successfully from it.
- **The embedded DSP recursion is numerically verified against Python**: the
  exact Direct-Form-II-Transposed biquad recursion used in
  `firmware/esp32/lib/core/dsp.cpp` was independently re-implemented in
  Python and cross-checked bit-for-bit (`max abs diff == 0.0`) against
  `scipy.signal.sosfilt` on the same coefficients before being translated to
  C++. A golden input/output vector
  (`firmware/esp32/lib/core/dsp_golden_vector.h`) generated from the
  production Python `CausalBlinkBandFilter` is compared against the C++ port
  at every ESP32 boot (`runDspSelfTest()` in `src/diagnostics.cpp`, printed
  over serial as `DSP_SELF_TEST:PASS`/`FAIL`).
- **The Muse 2 BLE protocol decode logic (`lib/core/muse_protocol.cpp`) was
  manually cross-checked** against a live run of the reference JS encoder
  (`node -e "..."` computing the exact expected byte sequence for
  `encodeControlCommand("p21")` etc.) before being trusted, not just
  translated and assumed correct — see that file's own comments.

### What has NOT been verified

- **No physical ESP32 hardware** was available — the firmware has never
  been flashed to or run on a real board. Nothing about GPIO behavior, PWM
  output, button/limit-switch wiring, or serial timing has been confirmed
  against real hardware. Follow [SAFETY.md](SAFETY.md)'s bench-test order.
- **No host C/C++ compiler was available** in this environment (checked:
  no `gcc`/`g++`/`clang`/`cl.exe` on `PATH`). `firmware/esp32/test/test_native/`
  contains PlatformIO/Unity unit tests for the hardware-independent logic
  (`safety_state_machine.h`, `command_parser.h`, `dsp.h`) — confirmed to be
  syntactically valid PlatformIO test files (the `native` platform and
  Unity framework both installed successfully via `pio test -e native`),
  but the actual compile step fails with `'g++' is not recognized...` in
  this environment. **Run `pio test -e native` on a machine with a C++
  compiler installed to actually execute them** before trusting that
  refactor to `lib/core/` hasn't broken anything.

### Running what can be run here

```bash
cd firmware/esp32
pio run -e esp32dev          # compiles for the real target; verified working
pio test -e native           # requires a host compiler; not available here
```

### Regenerating the embedded filter coefficients

If `config/default_config.yaml`'s `dsp` section changes, or the Muse 2's
real sampling rate is confirmed to differ from
`acquisition.fallback_sample_rate_hz` (WAITING FOR HARDWARE VERIFICATION):

```bash
python scripts/generate_esp32_filter_coeffs.py
```

This regenerates `firmware/esp32/lib/core/dsp_coeffs.h` directly from the
same `scipy.signal.butter`/`iirnotch` calls the PC pipeline uses — never
hand-edit that file. You'll also need to regenerate
`dsp_golden_vector.h` (see the Python snippet in that file's own header
comment) so the boot-time self-test stays in sync.

## What is genuinely untested end-to-end

- Real Muse 2 acquisition (`acquisition/brainflow_source.py`) — written
  against BrainFlow's public API but never run against a physical device.
- Real PC↔ESP32 serial round-trip — `communication/serial_link.py` is unit
  tested against a fake transport; the framing has never been exchanged with
  actual firmware on actual hardware.
- Anything downstream of either of the above (embedded DSP on real signal,
  motor response to a real double blink, latency with real BLE transport).
