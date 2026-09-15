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

```bash
pip install platformio   # or: pip install -e ".[dev]" then `pio` if bundled
cd firmware/esp32
pio run -e esp32dev              # build only (verified working in this repo's dev environment)
pio run -e esp32dev -t upload    # build + flash — requires a connected ESP32 (WAITING FOR HARDWARE VERIFICATION)
pio device monitor -b 115200     # serial monitor
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

## Mode B (direct Muse 2 → ESP32 BLE)

**Not implemented. WAITING FOR HARDWARE / BLE VERIFICATION.** Per the
project brief's explicit instruction, no Muse 2 BLE GATT UUIDs, packet
formats, or pairing behavior have been fabricated anywhere in this
repository. `acquisition/brainflow_source.py` documents BrainFlow as the
verified, actively-maintained path for Muse 2 access on a PC (Mode A); a
future direct ESP32-BLE bridge would need its own from-scratch verification
against either Muse's own published documentation or a reliable
already-verified open-source implementation — not invented here.
