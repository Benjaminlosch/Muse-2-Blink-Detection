import { useState } from "react";
import { appEngine } from "../../engine/appEngine";
import { defaultConfig } from "../../core/config";
import { useAppStore } from "../../state/appStore";
import { Card } from "../common/Card";
import { Button } from "../common/Button";

function NumberField({
  label, help, value, onChange, step = 0.1, min, max,
}: { label: string; help: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--text)]" title={help}>
        {label}
      </span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded border border-[var(--border-strong)] bg-[var(--bg-panel-raised)] px-2 py-1 text-sm text-[var(--text-bright)]"
      />
      <span className="text-[11px] text-[var(--text-dim)]">{help}</span>
    </label>
  );
}

export function Filters() {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const [draft, setDraft] = useState(config.dsp);
  const [error, setError] = useState<string | null>(null);

  function apply() {
    if (draft.highpassHz < 0) return setError("High-pass cutoff must be >= 0.");
    if (draft.lowpassHz <= draft.highpassHz) return setError("Low-pass cutoff must be greater than the high-pass cutoff.");
    if (draft.filterOrder < 1) return setError("Filter order must be >= 1.");
    setError(null);
    setConfig({ ...config, dsp: draft });
    appEngine.applyConfig();
  }

  function resetToDefault() {
    const d = defaultConfig().dsp;
    setDraft(d);
    setConfig({ ...config, dsp: d });
    appEngine.applyConfig();
  }

  function revert() {
    setDraft(config.dsp);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Causal DSP settings"
        actions={
          <div className="flex gap-2">
            <Button onClick={revert}>Revert</Button>
            <Button onClick={resetToDefault}>Reset to Default</Button>
            <Button variant="primary" onClick={apply}>Apply</Button>
          </div>
        }
      >
        <p className="mb-3 text-xs text-[var(--text-dim)]">
          Matches the causal, sample-by-sample filter chain used everywhere in this app (never a zero-phase/offline
          filter) — see docs/WEB_DSP_EQUIVALENCE.md. Changing these values re-creates the worker's filter state.
        </p>
        {error && <div className="mb-3 rounded bg-[var(--danger)]/15 px-3 py-2 text-xs text-[var(--danger)]">{error}</div>}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <NumberField
            label="High-pass cutoff (Hz)"
            help="Removes DC offset and slow baseline drift."
            value={draft.highpassHz}
            onChange={(v) => setDraft({ ...draft, highpassHz: v })}
          />
          <NumberField
            label="Low-pass cutoff (Hz)"
            help="Removes high-frequency muscle/EMG content above the blink band."
            value={draft.lowpassHz}
            onChange={(v) => setDraft({ ...draft, lowpassHz: v })}
          />
          <NumberField
            label="Filter order"
            help="Butterworth prototype order — higher = steeper rolloff, more phase delay."
            value={draft.filterOrder}
            step={1}
            min={1}
            onChange={(v) => setDraft({ ...draft, filterOrder: Math.round(v) })}
          />
          <NumberField
            label="Notch frequency (Hz)"
            help="Mains interference frequency (60Hz in the US)."
            value={draft.notchHz}
            onChange={(v) => setDraft({ ...draft, notchHz: v })}
          />
          <NumberField
            label="Notch Q"
            help="Higher Q = narrower notch, less collateral attenuation of nearby content."
            value={draft.notchQualityFactor}
            step={1}
            onChange={(v) => setDraft({ ...draft, notchQualityFactor: v })}
          />
          <NumberField
            label="Baseline tracker time constant (s)"
            help="Slow EMA used for adaptive baseline/DC removal, complementing the high-pass corner."
            value={draft.baselineTrackerTimeConstantS}
            onChange={(v) => setDraft({ ...draft, baselineTrackerTimeConstantS: v })}
          />
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.notchEnabled}
            onChange={(e) => setDraft({ ...draft, notchEnabled: e.target.checked })}
          />
          Notch filter enabled
        </label>
      </Card>

      <Card title="Values">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--text-dim)]">
              <th className="pb-1">Setting</th>
              <th className="pb-1">Current</th>
              <th className="pb-1">Default</th>
            </tr>
          </thead>
          <tbody className="text-[var(--text)]">
            {(Object.keys(defaultConfig().dsp) as Array<keyof typeof draft>).map((k) => (
              <tr key={k} className="border-t border-[var(--border)]">
                <td className="py-1">{k}</td>
                <td className="py-1">{String(config.dsp[k])}</td>
                <td className="py-1 text-[var(--text-dim)]">{String(defaultConfig().dsp[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
