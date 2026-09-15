# BCI Hand Configurator (web app)

Browser-based operator UI for the Muse 2 blink-controlled prosthetic hand
project. Connects to a Muse 2 (Web Bluetooth) and an ESP32 (Web Serial)
directly from Chrome or Edge — no install, no backend, nothing uploaded.

See the top-level [`../README.md`](../README.md) and
[`../docs/WEB_APP.md`](../docs/WEB_APP.md) for full documentation. This
file only covers the commands specific to this `web/` package.

```bash
npm install
npm run dev          # http://localhost:5173
npm run test          # vitest — includes the Python equivalence test
npm run typecheck     # tsc -b --noEmit
npm run build           # production build -> dist/
npm run preview         # serve the production build locally
```

Relevant docs:

- [`../docs/WEB_APP.md`](../docs/WEB_APP.md) — architecture
- [`../docs/WEB_BLUETOOTH.md`](../docs/WEB_BLUETOOTH.md) — Muse 2 protocol verification
- [`../docs/WEB_SERIAL.md`](../docs/WEB_SERIAL.md) — ESP32 serial protocol
- [`../docs/WEB_DSP_EQUIVALENCE.md`](../docs/WEB_DSP_EQUIVALENCE.md) — how `src/core/` is checked against Python
- [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) — build/deploy
- [`../docs/LAB_USER_GUIDE.md`](../docs/LAB_USER_GUIDE.md) — operating this at the lab
