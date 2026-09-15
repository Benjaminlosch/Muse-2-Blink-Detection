# ESP32 Setup

**Status: WAITING FOR HARDWARE VERIFICATION.** Everything in this document
describes firmware that compiles successfully against the real ESP32
toolchain (see [TESTING.md](TESTING.md)) but has never been flashed to or
run on physical hardware. Follow [SAFETY.md](SAFETY.md)'s bench-test order —
do not skip straight to attaching a motor.

## Hardware configuration

Two historical motor-control configurations are supported, selected at
compile time in `firmware/esp32/include/config.h`:

| | `MOTOR_MODE_DC_HBRIDGE` (default) | `MOTOR_MODE_SERVO` |
|---|---|---|
| Pins | `PWM_PIN=25`, `DIR_PIN=26`, `CLOSE_BUTTON=18`, `OPEN_BUTTON=19` | `SERVO_PIN=23` |
| Control | PWM duty + direction pin, via `ledcSetup`/`ledcWrite` | 50Hz servo pulse, computed manually via `ledcSetup`/`ledcWrite` (no external servo library dependency) |

These pin numbers are **historical values** referenced in the project brief,
not verified against any specific physical build present in this
environment (there was none to inspect — `firmware/esp32/` was an empty
scaffold before this work). Confirm actual wiring before flashing.

To build the servo variant instead of the default:

```ini
; firmware/esp32/platformio.ini
build_flags = -Iinclude -D MOTOR_MODE_SERVO=1
```

## Building and flashing

Two build environments (see `firmware/esp32/platformio.ini`):

```bash
pip install platformio   # or: pip install -e ".[dev]" then `pio` if bundled
cd firmware/esp32

# Mode A — PC/browser does acquisition + detection, ESP32 is a serial-driven
# safety receiver + motor controller. Most-verified path.
pio run -e esp32dev
pio run -e esp32dev -t upload    # build + flash — requires a connected ESP32 (WAITING FOR HARDWARE VERIFICATION)

# Mode B — ESP32 connects directly to the Muse 2 over BLE and runs the full
# pipeline itself. See "Mode B" below — calibrate on the web app first.
pio run -e esp32dev_standalone
pio run -e esp32dev_standalone -t upload

pio device monitor -b 115200     # serial monitor, either environment
```

If PlatformIO's package downloads fail with an SSL certificate error behind
a corporate antivirus/proxy that does TLS interception (this happened during
development — AVG Antivirus intercepts TLS and needed its own CA cert
trusted), point pip/PlatformIO at that certificate:

```bash
pip config set global.cert "<path to your antivirus's CA .pem>"
# and, for the same session, before `pio` commands that hit the network:
export SSL_CERT_FILE="<path>" REQUESTS_CA_BUNDLE="<path>" CURL_CA_BUNDLE="<path>"
```

## What happens at boot

1. Serial begins at 115200 baud.
2. `runDspSelfTest()` runs the embedded filter against a golden vector
   generated from the Python production filter and prints
   `DSP_SELF_TEST:PASS` or `DSP_SELF_TEST:FAIL max_abs_diff_uv=<value>` —
   check this first, before anything else, on real hardware.
3. The motor interface initializes to an inert state (0 PWM duty for the
   H-bridge; the HOLD angle for the servo) — **the motor never moves on
   boot**.
4. `STATE:HOLD` is printed — the firmware's own startup state is always
   HOLD, independent of whatever the PC last commanded before a reset.

## Serial protocol

Byte-for-byte identical to `src/bcihand/communication/protocol.py` (see that
file's docstring) and mirrored in `firmware/esp32/include/protocol.h`:

```
PC -> ESP32:   CMD:OPEN\n   CMD:CLOSE\n   CMD:HOLD\n   HEARTBEAT\n
ESP32 -> PC:   ACK:<CMD>\n  STATE:<STATE>\n  HB_ACK\n
```

The protocol is strict and case-sensitive on purpose — see
`test_command_parser.cpp`'s `test_case_sensitive_lowercase_command_is_invalid`.
An unrecognized frame is `FrameKind::kInvalid`, which forces `HOLD`
immediately (see [SAFETY.md](SAFETY.md)).

You can exercise this by hand over a serial terminal before ever running
`scripts/run_pipeline.py --serial-port COMx`:

```
> CMD:OPEN
< ACK:OPEN
< STATE:OPEN
> HEARTBEAT
< HB_ACK
```

## Communication timeout

`config.communication.timeout_s` (default 1.5s, mirrored as
`timing::kCommTimeoutMs` in `firmware/esp32/include/config.h`) — if no frame
(command or heartbeat) arrives within this window, the firmware's own
`SafetyStateMachine` forces `HOLD` regardless of the last commanded state.
This is independent of the PC's own communication-loss handling in
`confidence_gate.py` — see [SAFETY.md](SAFETY.md) "Defense in depth."

## Mode B (direct Muse 2 → ESP32 BLE, standalone operation)

**Implemented and compiles/links successfully against the real ESP32
toolchain. WAITING FOR HARDWARE VERIFICATION** — never exercised against a
physical Muse 2 or ESP32.

```
Muse 2 --BLE--> ESP32 [full pipeline runs here] --> motor
```

No PC, browser, or serial link is needed at runtime. This is the
`esp32dev_standalone` build environment (`-D OPERATING_MODE_STANDALONE=1`,
`src/main_standalone.cpp`).

### What's in it

- **`firmware/esp32/lib/core/`**: a complete, from-scratch C++ port of the
  entire detection/classification pipeline — `candidate_detector`,
  `adaptive_threshold` (median/MAD, same robust-statistics approach as
  Python/TypeScript), `features`, `spatial`, `signal_quality`,
  `motion_veto`, `blink_classifier`, `blink_state_machine` (the
  double-blink timing FSM — named separately from
  `safety_state_machine.h`'s unrelated `SafetyStateMachine`),
  `confidence_gate`, `command_mapper`, and `blink_pipeline` (the
  orchestrator, mirroring `pipeline.py` / `web/src/core/pipeline.ts`'s
  `processSample()` stage-for-stage). This is a careful line-by-line
  translation of the same logic already validated in Python (148 tests)
  and TypeScript (19 tests, including a full Python-golden-run
  equivalence check) — but this specific C++ port has **no automated
  equivalence test of its own** yet (no host C++ compiler was available
  to run one — see [TESTING.md](TESTING.md) "Known gap"). Treat it as
  reviewed-and-compiles, not independently verified output-for-output.
- **`firmware/esp32/lib/core/muse_protocol.h`/`.cpp`**: the same verified
  Muse 2 BLE protocol constants and 12-bit sample decoding as
  `web/src/muse/protocol.ts` (see [WEB_BLUETOOTH.md](WEB_BLUETOOTH.md) for
  the source verification) — ported to C++, not re-derived.
- **`firmware/esp32/lib/core/eeg_zipper.h`**: the same 4-channel sample
  synchronization strategy as `web/src/muse/eegZipper.ts`.
- **`firmware/esp32/src/muse_ble_client.h`/`.cpp`**: the ESP32-as-BLE-
  central connection, using
  [h2zero/NimBLE-Arduino](https://github.com/h2zero/NimBLE-Arduino)
  (actively maintained — verified via its own commit history and official
  client example before adding as a dependency, not assumed). Lower memory
  footprint and a cleaner central/client-mode API than the stock
  Arduino-ESP32 BLE library.
- **`firmware/esp32/src/main_standalone.cpp`**: wires it together — scans
  for and connects to a Muse 2, feeds samples through `BlinkPipeline`,
  drives the motor from the resolved command. Forces `HOLD` directly
  (bypassing the pipeline) whenever the Muse 2 isn't connected, mirroring
  Mode A's comm-timeout-to-HOLD behavior.

### The calibration → firmware workflow

This is the actual "train it, then make it standalone" loop:

1. Calibrate on the web app (Calibration page) against your real Muse 2 —
   see [CALIBRATION.md](CALIBRATION.md).
2. Click **Export ESP32 Config** — downloads `pipeline_config.h` with your
   tuned thresholds baked in as compile-time constants.
3. Replace `firmware/esp32/lib/core/pipeline_config.h` with the downloaded
   file.
4. `pio run -e esp32dev_standalone -t upload`.
5. From then on, the ESP32 runs independently — no laptop, no browser, no
   server. (This exact drop-in-and-rebuild step has been verified in this
   repo's dev environment: a generated `pipeline_config.h` was substituted
   in and the firmware rebuilt successfully — see
   [TESTING.md](TESTING.md).)

### Verified vs. not

| | Status |
|---|---|
| Compiles against the real ESP32 toolchain (both `esp32dev` and `esp32dev_standalone`) | ✅ Verified in this repo's dev environment |
| Links against real NimBLE-Arduino with zero errors | ✅ Verified |
| Generated `pipeline_config.h` drops in and rebuilds | ✅ Verified |
| Embedded DSP filter matches Python bit-for-bit | ✅ Verified (boot self-test + golden vector) |
| Embedded detection/classification pipeline matches Python/TypeScript output | ❌ Not independently verified (no host compiler available — see TESTING.md) |
| Actual BLE connection to a physical Muse 2 | ❌ WAITING FOR HARDWARE VERIFICATION |
| RAM/flash headroom on real hardware | Estimated only (11.7% RAM / 48.1% flash from the build's own reporting) — not measured under real runtime load |
