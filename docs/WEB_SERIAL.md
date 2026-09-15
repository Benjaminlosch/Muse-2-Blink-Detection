# Web Serial (ESP32)

**Status: WAITING FOR HARDWARE VERIFICATION.** Written against the Web
Serial API and the protocol verified in `firmware/esp32/include/protocol.h`
/ `src/bcihand/communication/protocol.py`, but never exercised against
physical ESP32 firmware.

## Protocol

Byte-for-byte identical to `src/bcihand/communication/protocol.py` and
`firmware/esp32/include/protocol.h` — this is a straight port, not a new
design (`web/src/esp32/protocol.ts`):

```
Browser -> ESP32:  CMD:OPEN\n   CMD:CLOSE\n   CMD:HOLD\n   HEARTBEAT\n
ESP32 -> Browser:  ACK:<CMD>\n  STATE:<STATE>\n  HB_ACK\n
```

Case-sensitive, strict framing — see `esp32/protocol.test.ts`.

## Comm health model

`Esp32Client.isHealthy(timeoutMs)` mirrors
`communication/serial_link.py::SerialLink.is_healthy()` exactly: comm
health is a **pull-based** check derived purely from elapsed time since the
last recognized frame, not a push notification the app passively trusts.
`engine/appEngine.ts` polls this every 250ms and forwards the result to the
pipeline worker via a `setCommOk` message, which becomes the
`comm_ok_provider()` the confidence gate checks on every sample — the exact
same mechanism `scripts/run_pipeline.py --serial-port` uses on the Python
side. See `docs/SAFETY.md` "Defense in depth."

Important distinction: **"ESP32 not connected"** and **"ESP32 connected but
unhealthy"** are different states. When no ESP32 is connected at all, `comm_ok`
defaults to `true` (matching Python's `comm_ok_provider` default of
`lambda: True` for pure simulation/PC-only runs) — otherwise Simulation Mode
would be permanently stuck reporting "communication lost" with no ESP32
ever attached. Once actually connected, health is tracked for real and a
dropout forces `HOLD`.

## Output arming

Per project brief section 22, connecting an ESP32 does **not** by itself
allow commands to reach it. `engine/appEngine.ts::maybeForwardCommandToEsp32()`
only sends a resolved command when `store.esp32OutputArmed` is explicitly
`true` — set via the ESP32 page's "Arm Output" button, never automatically.
Disconnecting resets `esp32OutputArmed` to `false` and forces the pipeline
worker's `commOk` back to `true` (not-connected default) — see the ESP32
page's `onConnectionStateChange` handler.

## Connecting

1. Flash `firmware/esp32/` (see `docs/ESP32_SETUP.md`) — WAITING FOR
   HARDWARE VERIFICATION.
2. Plug the ESP32 into the lab computer via USB.
3. On the ESP32 page (or the header), click **Connect ESP32**.
4. The browser's native serial port chooser appears — select the ESP32's
   port.
5. Confirm the heartbeat indicator turns green (`ACK`/`STATE`/`HB_ACK`
   frames arriving) before arming output.
6. **Arm Output** only when the physical hand is ready per
   `docs/SAFETY.md`'s bench-test order. `TEST OPEN`/`TEST CLOSE` on the
   ESP32 page can move a connected motor **regardless of the output-armed
   toggle** — they are direct manual test commands, clearly labeled with a
   warning in the UI.

## What is NOT verified

- Real serial framing/timing against actual firmware (only unit-tested
  against a fake transport-equivalent in `esp32Client`'s design, and the
  protocol encode/decode functions themselves in `protocol.test.ts`).
- Whether Chrome/Edge's Web Serial driver behaves identically to Python's
  `pyserial` for the same physical ESP32/USB-serial chipset.
- Actual heartbeat-timeout-to-HOLD behavior on real hardware under a
  genuine cable-unplug event.
