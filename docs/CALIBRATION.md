# Calibration

Why this exists, what it does, and — importantly — what it cannot do.

## Why not one universal threshold

Blink amplitude, duration, and rise/fall shape vary meaningfully between
people (electrode contact, skin impedance, forehead geometry, eyelid
strength). A single hard-coded microvolt threshold either misses a lot of
genuine blinks for some users, or false-triggers constantly for others. See
`config/default_config.yaml`'s `candidate_detection.min_prominence_uv` —
marked "starting hypothesis, overridden by calibration."

## The honest limitation, stated up front

Physiologically, **a deliberate single blink and a spontaneous single blink
often look very similar in amplitude and shape.** No amount of calibration
can manufacture a separation that doesn't exist in the underlying
physiology. This is *why* this system's primary (in fact, only) control
signal is the double blink — an unusual, low-base-rate temporal pattern —
rather than the single blink. Calibration tunes amplitude/duration/spacing
thresholds; it does not and cannot solve "is this blink intentional" from
amplitude alone.

## What calibration measures

`scripts/calibrate.py` runs a fixed guided sequence
(`config.calibration.{rest,single_blink,double_blink}_trials`, default
3/3/3):

```text
REST, REST, REST, SINGLE_BLINK, SINGLE_BLINK, SINGLE_BLINK,
DOUBLE_BLINK, DOUBLE_BLINK, DOUBLE_BLINK
```

Each trial is filtered through the same `CausalBlinkBandFilter` chain the
live pipeline uses, then run through the candidate detector.
`detection/calibration.py::compute_calibration_stats()` derives, using
**median and MAD** (never mean/std — robust to the very outliers you're
trying to threshold against):

- Baseline / noise-floor median and MAD (from REST trials)
- Intentional blink peak amplitude, duration, rise time, fall time (from
  SINGLE_BLINK trials — see "A subtlety" below)
- Double-blink inter-blink spacing (from DOUBLE_BLINK trials)

`CalibrationStats.derive_config_overrides()` turns these into a
`config/calibration_active.yaml` override, which `utils/config.py`'s
`load_config()` automatically deep-merges on top of
`config/default_config.yaml` on every subsequent run — no code changes
needed to pick up a new calibration.

### A subtlety this project actually hit: filter ringing contaminating trial stats

A SINGLE_BLINK calibration trial can produce *more than one* width-valid
candidate: the real blink, its filter rebound (excluded — see
[SIGNAL_PIPELINE.md](SIGNAL_PIPELINE.md)), and occasionally smaller same-sign
ringing beyond the immediate rebound-guard window. `compute_calibration_stats`
takes only the single **largest-amplitude** candidate per SINGLE_BLINK trial
(and the two largest for DOUBLE_BLINK trials) specifically to prevent this
ringing from being pooled into the median and dragging the derived
`min_prominence_uv` down to a value dominated by noise rather than the actual
instructed blink.

### A second subtlety: an overly tight calibration can reject its own double blinks

A calibration session with very low natural variability (few trials, or — as
found directly while building this script — a fully deterministic simulated
session) can produce a measured MAD of ~0. Without a floor, that collapses
the derived thresholds to essentially the exact calibration-trial values,
which then **rejects** a double blink's second pulse: it legitimately
measures lower peak-prominence than an isolated single blink, because it
rides on the first pulse's still-decaying filter tail.
`derive_config_overrides()` applies a floor (`min_relative_prominence_spread`,
default 50% of the measured median) to guard against this. `scripts/calibrate.py`
additionally **self-checks** its own output before saving: it replays the
calibration trials themselves through the full classifier under the derived
thresholds and warns if fewer valid blinks come out than the trial protocol
implies. Do not ignore that warning.

## Running calibration

```bash
# Fully automated (simulated data, useful for testing the script itself):
python scripts/calibrate.py --source simulate

# Real Muse 2 — WAITING FOR HARDWARE VERIFICATION:
python scripts/calibrate.py --source muse2
```

The `--source muse2` path prompts you before each trial ("Get ready for
SINGLE_BLINK... Press Enter to start"), then collects real samples for that
trial's duration. It has not been exercised against a physical Muse 2 in the
environment this was built in.

See `config/calibration_example.yaml` for what the output actually looks
like (generated from a simulated session — not real user data; do not use it
for physical hand control).

## Recalibrating

Just re-run `scripts/calibrate.py` — it overwrites
`config/calibration_active.yaml` (gitignored; see `config/calibration_*.yaml`
in `.gitignore` — these are machine/user-specific, not committed). There is
no separate "reset" command: delete the file to fall back to
`config/default_config.yaml`'s defaults.

## Calibrating from the web app, and exporting to the ESP32

The web app (`web/src/components/pages/Calibration.tsx`) runs the same
guided REST → SINGLE_BLINK → DOUBLE_BLINK trial sequence and the same
median/MAD statistics (`core/detection/calibration.ts`, a verified port of
`detection/calibration.py`) against a live Muse 2 connected over Web
Bluetooth, or against Simulation Mode. This is the intended day-to-day way
to calibrate — the website's role is strictly this: connect to the Muse 2,
run and preview calibration, and produce a tuned config. It is not meant to
grow beyond that (see [ESP32_SETUP.md](ESP32_SETUP.md) "Mode B").

After a calibration run completes, two buttons are available:

- **Save Calibration** — applies the derived thresholds to the running web
  app itself (for Mode A: PC/browser does detection, ESP32 is a serial
  motor controller) and persists them to browser storage.
- **Export ESP32 Config** — downloads `pipeline_config.h`, a compile-time
  C++ header with the same derived thresholds baked in as constants
  (`web/src/core/exportEsp32Config.ts`; see that file and
  `firmware/esp32/lib/core/pipeline_config.h`'s own header comments). Drop
  this in place of `firmware/esp32/lib/core/pipeline_config.h` and rebuild
  the `esp32dev_standalone` environment — this is the entire "train on the
  website, then run standalone on the ESP32 with no PC/server involved"
  workflow. The idle-screen version of this button uses whatever
  calibration is already loaded (from a prior session, via **Load Saved
  Calibration**); the post-wizard version uses the just-computed results
  directly, before you decide whether to also **Save Calibration**.

This export path and the drop-in rebuild have both been verified in this
repo's dev environment (see [TESTING.md](TESTING.md) and
[ESP32_SETUP.md](ESP32_SETUP.md)); an actual BLE connection to a physical
Muse 2, from either the browser or the ESP32 directly, has not — see
"WAITING FOR HARDWARE VERIFICATION" in those documents.
