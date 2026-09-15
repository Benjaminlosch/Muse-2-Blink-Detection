import { useState } from "react";
import { appEngine } from "../../engine/appEngine";
import { useAppStore } from "../../state/appStore";
import { Card } from "../common/Card";
import { Button } from "../common/Button";

const MAPPING_OPTIONS = ["HOLD", "OPEN", "CLOSE", "TOGGLE_OPEN_CLOSE", "NONE"] as const;

export function Commands() {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const [draft, setDraft] = useState(config.communication.commandMapping);

  function apply() {
    setConfig({ ...config, communication: { ...config.communication, commandMapping: draft } });
    appEngine.applyConfig();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="Blink event -> command mapping">
        <p className="mb-3 text-xs text-[var(--text-dim)]">
          Configurable, not hard-coded (project brief section 10/23) — so the mapping can change without touching
          detector logic. "Uncertain" always resolves to HOLD regardless of this setting; it exists purely for
          documentation/consistency with the Python reference's config schema.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MappingField label="Double blink (high confidence)" value={draft.doubleBlink} onChange={(v) => setDraft({ ...draft, doubleBlink: v })} />
          <MappingField label="Single blink" value={draft.singleBlink} onChange={(v) => setDraft({ ...draft, singleBlink: v })} />
          <MappingField label="Uncertain" value={draft.uncertain} disabled onChange={() => {}} />
        </div>
        <div className="mt-4">
          <Button variant="primary" onClick={apply}>Apply</Button>
        </div>
      </Card>

      <Card title="Live mapping">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--text-dim)]">
              <th className="pb-1">Intent</th>
              <th className="pb-1">Maps to</th>
            </tr>
          </thead>
          <tbody className="text-[var(--text)]">
            <tr className="border-t border-[var(--border)]"><td className="py-1">double_blink</td><td className="py-1 font-medium">{config.communication.commandMapping.doubleBlink}</td></tr>
            <tr className="border-t border-[var(--border)]"><td className="py-1">single_blink</td><td className="py-1 font-medium">{config.communication.commandMapping.singleBlink}</td></tr>
            <tr className="border-t border-[var(--border)]"><td className="py-1">uncertain</td><td className="py-1 font-medium">HOLD (always)</td></tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function MappingField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--text)]">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-[var(--border-strong)] bg-[var(--bg-panel-raised)] px-2 py-1.5 text-sm text-[var(--text-bright)] disabled:opacity-50"
      >
        {MAPPING_OPTIONS.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
