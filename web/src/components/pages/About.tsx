import { Card } from "../common/Card";

export function About() {
  return (
    <div className="flex flex-col gap-4">
      <Card title="BCI Hand Configurator">
        <p className="text-sm text-[var(--text)]">
          A browser-based configurator for the Muse 2 → blink detection → ESP32 → prosthetic hand pipeline. Runs
          entirely client-side: EEG acquisition (Web Bluetooth) and processing happen locally in your browser: no
          account, no backend, nothing uploaded. See project brief sections 1–5.
        </p>
      </Card>

      <Card title="Documentation">
        <ul className="list-inside list-disc space-y-1 text-sm text-[var(--text)]">
          <li><code>docs/WEB_APP.md</code> — architecture of this application</li>
          <li><code>docs/WEB_BLUETOOTH.md</code> — Muse 2 protocol verification notes</li>
          <li><code>docs/WEB_SERIAL.md</code> — ESP32 serial protocol reference</li>
          <li><code>docs/WEB_DSP_EQUIVALENCE.md</code> — how the TypeScript core is verified against Python</li>
          <li><code>docs/LAB_USER_GUIDE.md</code> — step-by-step guide for operating this at the lab</li>
          <li><code>docs/DEPLOYMENT.md</code> — how this app is built and deployed</li>
          <li><code>docs/SAFETY.md</code> — the fail-safe rules this whole system is built around</li>
        </ul>
      </Card>

      <Card title="Golden reference">
        <p className="text-sm text-[var(--text)]">
          The Python implementation in <code>src/bcihand/</code> is the trusted, tested reference. Every module in{" "}
          <code>web/src/core/</code> is a direct port, and <code>web/src/core/pipeline.test.ts</code> replays raw
          samples exported directly from a real Python run and asserts the browser pipeline reproduces the same
          candidates, classifications, state-machine events, and commands.
        </p>
      </Card>
    </div>
  );
}
