# Lab User Guide

For operating BCI Hand Configurator at the lab. No developer credentials,
terminal, Python, Git, VS Code, or MATLAB required — just a browser and the
URL.

## What you need

- A laptop/desktop running **Google Chrome** or **Microsoft Edge** (not
  Firefox or Safari — Web Bluetooth/Serial aren't available there).
- The Muse 2 headband, charged.
- The deployed app URL (get this from whoever set up the project's
  deployment — see `docs/DEPLOYMENT.md`).
- The ESP32 + prosthetic hand, only if you're testing hand control (Muse-only
  blink detection works without it).

## Steps

1. **Open Chrome or Edge** and go to the app URL.
2. The app checks compatibility automatically — if you see a yellow banner
   at the top, read it (it tells you exactly what's missing, e.g. "not
   served over HTTPS" or "open this in Chrome/Edge"). Simulation Mode works
   even if hardware APIs aren't available.
3. **Turn on the Muse 2** — slide/hold its power button until the LEDs
   blink.
4. Click **CONNECT MUSE 2** in the top bar.
5. Your browser's own device picker will pop up. **Select the Muse
   headset** from the list and click Pair/Connect.
6. Go to the **Live EEG** page and confirm all four channels (AF7, AF8,
   TP9, TP10) are showing moving traces, not flat lines. If a channel looks
   flat or extremely noisy, the electrode isn't making good contact —
   reposition the headband.
7. **Calibrate** (recommended each session): go to the **Calibration**
   page, click **Start Calibration**, and follow the on-screen prompts
   exactly — sit still during REST steps, blink once (deliberately) during
   SINGLE BLINK steps, and do one fast double blink during DOUBLE BLINK
   steps. At the end, review the summary. If you see a warning that not
   every trial produced a detected blink, click **Retry** and blink more
   deliberately. Click **Save Calibration** when you're happy with it.
8. Watch the **Blink Detector** and **Double Blink** pages to see live
   detection — you should see your double blinks show up as
   `DOUBLE_BLINK_CONFIRMED` events.
9. **Connect ESP32** (only if testing hand control): click **Connect
   ESP32** in the top bar, select the ESP32's port from the browser's
   picker, and confirm the heartbeat indicator turns green.
10. **Enable output** only when the physical hand is actually ready to
    move safely: go to the **ESP32** page and click **Arm Output**. Before
    this, the system will never send movement commands to the hand, no
    matter what it detects.
11. **Test**: perform a deliberate fast double blink. Watch the Dashboard's
    big command indicator (HOLD → OPEN or CLOSE) and, if a hand is
    attached, watch it move.

## If something goes wrong

| What you see | What it means |
|---|---|
| "Web Bluetooth is not available in this browser" | You're not in Chrome/Edge, or the page isn't served over HTTPS. |
| Muse connects then immediately shows "Not connected" | The Muse went to sleep or moved out of range — click Connect Muse 2 again. |
| Signal quality stuck low / red | Electrode contact issue — reposition the headband, make sure your forehead/behind-ear area is clean and dry. |
| ESP32 shows "No heartbeat" | Check the USB cable; the ESP32 firmware may have reset — HOLD is automatically maintained during this. |
| Nothing happens when you double blink | Check the Blink Detector page's "Last Rejection" reason, and the Diagnostics page's log — it will say exactly why (e.g. low confidence, AF7/AF8 disagreement, poor signal quality). |

## Safety reminders

- The hand only ever moves on a **deliberate, fast double blink** at high
  confidence. A single blink never moves it.
- **HOLD is always the safe state.** If anything is uncertain — poor
  signal, a dropped connection, low confidence — the system holds rather
  than guesses.
- Disconnecting the ESP32 automatically disarms output and returns to
  HOLD.
- The **TEST OPEN / TEST CLOSE** buttons on the ESP32 page can move a
  connected hand directly, for bench testing — use them carefully, and
  only with the motor either disconnected or unloaded per
  `docs/SAFETY.md`'s testing order, until the whole chain has been
  verified.
