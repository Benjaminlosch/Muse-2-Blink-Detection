# Web Bluetooth (Muse 2)

**Status: WAITING FOR HARDWARE VERIFICATION.** Everything below is verified
against real source code, not invented — but has never been exercised
against a physical Muse 2.

## Why not fabricate the protocol

Muse does not publish official BLE GATT documentation. Per the explicit
project instruction not to invent UUIDs, packet formats, or pairing
behavior, this app's protocol constants
(`web/src/muse/protocol.ts`) were derived by directly reading the actual
source of two independent, real, open-source projects — not from general
Bluetooth knowledge or memory:

| Source | What it confirmed |
|---|---|
| [`itayinbarr/web-muse`](https://github.com/itayinbarr/web-muse) — actively maintained (last push 2025-12-02 at verification time), explicitly "tested with Muse 2 and Muse S", includes mock-data support | Service UUID, all characteristic UUIDs, 12-bit EEG sample packing, control-command encoding, EEG channel ordering (via its mock-data-loader comments: `TP9, AF7, AF8, TP10`) |
| [`urish/muse-js`](https://github.com/urish/muse-js) — the original/most-established library (306 stars), TypeScript, explicit Muse 2 support (npm last published 2021-12-20, so not itself "actively maintained", but its source is a precise, long-relied-upon reference) | Independently confirms every UUID and the 12-bit decode/scale math **byte-for-byte identical** to web-muse; explicitly exports `channelNames = ['TP9', 'AF7', 'AF8', 'TP10', 'AUX']`, confirming channel ordering; documents the `EEG_FREQUENCY = 256` sample rate and the meaning of the different streaming presets (`p21`/`p50`/`p20`) |

Both were fetched and read in full (via GitHub's API, working around a
local TLS-interception SSL issue) before writing `protocol.ts` — see that
file's own citations.

## Why a from-scratch port, not a dependency

Neither library was taken as an npm dependency:

- `web-muse` is not published to npm (would require a `github:` git
  dependency — less stable/reproducible for a deployed static site) and is
  plain JavaScript, not TypeScript.
- `muse-js` is on npm but hasn't been published since December 2021.

Given the protocol is now fully verified from two independent sources, the
lowest-risk choice was to write a small, typed, from-scratch implementation
(`web/src/muse/protocol.ts`, `eegZipper.ts`, `museClient.ts`) that integrates
directly with this app's Web Worker architecture, rather than depend on an
unmaintained/unpublished package.

## One deliberate deviation from web-muse

`web-muse`'s `MuseDevice.js` always sends the `p50` preset (which `muse-js`
documents as the PPG-enabling preset) on connect, regardless of whether PPG
is used. This app doesn't subscribe to the PPG characteristics at all, so
`protocol.ts` uses `p21` — `muse-js`'s own documented default for
"EEG only" — instead. This is called out explicitly in `protocol.ts`'s
comments so it isn't mistaken for an accidental typo.

## Sample synchronization

The Muse 2 streams TP9/AF7/AF8/TP10 as **four independently-notifying BLE
characteristics**, each firing its own `characteristicvaluechanged` event
with 12 samples per notification. `muse/eegZipper.ts` ports the buffering
strategy from `muse-js`'s `zip-samples.ts`: readings are buffered by a
shared group timestamp (derived from the device's own wrapping 16-bit
packet-index counter — `museClient.ts`'s `getTimestamp()`, also ported from
`muse-js`) and flushed together once all four channels have reported for
that group. If a group never completes (a dropped BLE notification), it is
**silently dropped** rather than emitting a sample with a missing channel —
see `eegZipper.ts`'s comment for why, and note that how often this actually
happens on a real link is itself WAITING FOR HARDWARE VERIFICATION.

## Architecture note: why acquisition runs on the main thread

Web Bluetooth (`navigator.bluetooth`) is not available inside a
`DedicatedWorkerGlobalScope` in current browsers. `MuseClient` therefore
runs on the main thread and forwards decoded samples to
`worker/pipelineWorker.ts` for processing — see `docs/WEB_APP.md`'s
architecture diagram.

## Connecting

1. Power on the Muse 2 (slide the button until the LEDs blink — this puts
   it into BLE advertising mode).
2. Click **CONNECT MUSE 2** in the app header.
3. The browser's native device chooser appears, filtered to devices
   advertising Muse's service UUID (`0xfe8d`) — select the headband.
4. Do **not** pre-pair the Muse 2 in the OS's own Bluetooth settings first —
   `navigator.bluetooth.requestDevice` does its own GATT-level pairing and
   a stale OS-level classic-Bluetooth pairing can interfere on some
   platforms.

## What is NOT verified

- Real-world reliability of the sample-synchronization/timestamp logic
  under actual BLE jitter/packet loss.
- Actual measured EEG sample rate on real hardware (assumed 256 Hz per both
  reference sources, matching `config/default_config.yaml`'s
  `fallback_sample_rate_hz`, but never independently confirmed against a
  physical device).
- Battery/telemetry decoding (`decodeTelemetry`) against real device output.
- Behavior on non-Chromium browsers (Web Bluetooth is Chromium-only by
  design; see `docs/WEB_APP.md`'s browser support section).
