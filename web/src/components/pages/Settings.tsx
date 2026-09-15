import { useRef, useState } from "react";
import { appEngine } from "../../engine/appEngine";
import { defaultConfig, type BciConfig } from "../../core/config";
import { buildDemoScenario, type SimEvent, type SimEventLabel } from "../../core/simulation/signalGenerator";
import { useAppStore } from "../../state/appStore";
import { downloadTextFile } from "../../state/recording";
import { Card } from "../common/Card";
import { Button } from "../common/Button";

const ARTIFACT_EVENTS: Array<{ label: SimEventLabel; title: string; event: SimEvent }> = [
  { label: "single_blink", title: "Single Blink", event: { label: "single_blink", onsetS: 1.0, durationS: 0.2, params: { amplitude_uv: 90 } } },
  { label: "double_blink", title: "Double Blink", event: { label: "double_blink", onsetS: 1.0, durationS: 0.58, params: { amplitude_uv: 95, gap_s: 0.22 } } },
  { label: "slow_blink", title: "Slow Blink", event: { label: "slow_blink", onsetS: 1.0, durationS: 0.45, params: { amplitude_uv: 80 } } },
  { label: "jaw_clench", title: "Jaw Clench", event: { label: "jaw_clench", onsetS: 1.0, durationS: 0.6, params: { amplitude_uv: 130 } } },
  { label: "head_motion", title: "Head Motion", event: { label: "head_motion", onsetS: 1.0, durationS: 0.8, params: { amplitude_uv: 60, accel_g: 0.35 } } },
  { label: "muscle_burst", title: "Muscle Noise", event: { label: "muscle_burst", onsetS: 1.0, durationS: 0.4, params: { amplitude_uv: 70 } } },
  { label: "baseline_drift", title: "Baseline Drift", event: { label: "baseline_drift", onsetS: 1.0, durationS: 3.0, params: { amplitude_uv: 50 } } },
  { label: "sixty_hz", title: "60 Hz Interference", event: { label: "sixty_hz", onsetS: 1.0, durationS: 2.0, params: { amplitude_uv: 15 } } },
  { label: "electrode_dropout", title: "Electrode Dropout", event: { label: "electrode_dropout", onsetS: 1.0, durationS: 1.5, params: { channel: "AF7" } } },
  { label: "single_channel_artifact", title: "Single-Channel Artifact", event: { label: "single_channel_artifact", onsetS: 1.0, durationS: 0.2, params: { channel: "AF8", amplitude_uv: 120 } } },
  { label: "random_spike", title: "Random Spike", event: { label: "random_spike", onsetS: 1.0, durationS: 0.02, params: { amplitude_uv: 150 } } },
  { label: "oversized_transient", title: "Oversized Transient", event: { label: "oversized_transient", onsetS: 1.0, durationS: 0.3, params: { amplitude_uv: 450 } } },
];

const PRESET_KEY = "bci-hand.config-presets.v1";

function loadPresets(): Record<string, BciConfig> {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function savePresets(presets: Record<string, BciConfig>): void {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  } catch {
    /* ignore */
  }
}

export function Settings() {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const mode = useAppStore((s) => s.mode);
  const [presets, setPresets] = useState<Record<string, BciConfig>>(loadPresets());
  const [presetName, setPresetName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function applyAndPush(next: BciConfig) {
    setConfig(next);
    appEngine.applyConfig();
  }

  function savePreset() {
    if (!presetName.trim()) return;
    const next = { ...presets, [presetName.trim()]: config };
    setPresets(next);
    savePresets(next);
  }
  function loadPreset(name: string) {
    const p = presets[name];
    if (p) applyAndPush(p);
  }
  function exportConfig() {
    downloadTextFile("bci-hand-config.json", JSON.stringify(config, null, 2), "application/json");
  }
  async function importConfig(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as BciConfig;
      applyAndPush(parsed);
    } catch {
      alert("Could not parse that file as a BCI Hand config JSON.");
    }
  }

  function runScenario(events: SimEvent[]) {
    appEngine.startSimulation(events);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="Acquisition mode">
        <p className="mb-3 text-xs text-[var(--text-dim)]">
          Current mode: <b className="text-[var(--text-bright)]">{mode.toUpperCase()}</b>. Live/replay are controlled
          from the header (Connect Muse 2) and the Recorder page; simulation scenarios are below.
        </p>
      </Card>

      <Card title="Simulation Mode — scenarios">
        <p className="mb-3 text-xs text-[var(--text-dim)]">
          Runs entirely in your browser using the same synthetic signal generator as the Python reference's test
          suite (project brief section 21) — useful for development away from the physical Muse 2.
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => runScenario(buildDemoScenario())}>Full Demo Scenario (one of everything)</Button>
          <Button onClick={() => appEngine.stopSimulation()}>Stop</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {ARTIFACT_EVENTS.map((e) => (
            <Button key={e.label} onClick={() => runScenario([e.event])}>{e.title}</Button>
          ))}
        </div>
      </Card>

      <Card title="Configuration presets">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => applyAndPush(defaultConfig())}>Load Default</Button>
          <input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Preset name"
            className="rounded border border-[var(--border-strong)] bg-[var(--bg-panel-raised)] px-2 py-1 text-sm text-[var(--text-bright)]"
          />
          <Button onClick={savePreset}>Save Current as Preset</Button>
          <Button onClick={exportConfig}>Export Config (JSON)</Button>
          <Button onClick={() => fileInputRef.current?.click()}>Import Config</Button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={importConfig} className="hidden" />
        </div>
        {Object.keys(presets).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.keys(presets).map((name) => (
              <Button key={name} onClick={() => loadPreset(name)}>{name}</Button>
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] text-[var(--text-dim)]">
          Presets and calibration are stored locally in this browser (localStorage) — no account, no cloud, nothing
          uploaded (project brief section 5/27).
        </p>
      </Card>
    </div>
  );
}
