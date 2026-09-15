import { useState } from "react";
import { appEngine } from "../../engine/appEngine";
import { useAppStore } from "../../state/appStore";
import { Card, StatTile } from "../common/Card";
import { Button } from "../common/Button";

export function ArtifactRejection() {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const recentResults = useAppStore((s) => s.recentResults);
  const [draft, setDraft] = useState(config.motionVeto);

  const last = recentResults[recentResults.length - 1];
  const lastWithClassification = [...recentResults].reverse().find((r) => r.classification !== null);
  const agreementCorr = lastWithClassification?.features?.af7Af8Correlation ?? null;
  const agreementRatio = lastWithClassification?.features?.af7Af8AmplitudeRatio ?? null;
  const motionPenalized = Boolean(lastWithClassification?.classification?.componentScores.motion_veto_penalty_applied);

  function apply() {
    setConfig({ ...config, motionVeto: draft });
    appEngine.applyConfig();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label="Signal quality"
          value={last ? `${Math.round(last.signalQuality.quality * 100)}%` : "—"}
          tone={!last ? "neutral" : last.signalQuality.quality >= 0.8 ? "ok" : last.signalQuality.quality >= 0.4 ? "warning" : "danger"}
        />
        <StatTile label="Flatline" value={last?.signalQuality.flatline ? "DETECTED" : "clear"} tone={last?.signalQuality.flatline ? "danger" : "ok"} />
        <StatTile label="Railed / oversized" value={last?.signalQuality.railed ? "DETECTED" : "clear"} tone={last?.signalQuality.railed ? "danger" : "ok"} />
        <StatTile label="Excessive noise" value={last?.signalQuality.excessiveNoise ? "DETECTED" : "clear"} tone={last?.signalQuality.excessiveNoise ? "warning" : "ok"} />
        <StatTile
          label="AF7/AF8 agreement"
          value={agreementCorr !== null ? (agreementCorr >= config.spatial.af7Af8MinCorrelation ? "GOOD" : "POOR") : "—"}
          sub={agreementCorr !== null ? `r=${agreementCorr.toFixed(2)}` : undefined}
          tone={agreementCorr === null ? "neutral" : agreementCorr >= config.spatial.af7Af8MinCorrelation ? "ok" : "danger"}
        />
        <StatTile label="Motion veto" value={motionPenalized ? "ACTIVE" : "inactive"} tone={motionPenalized ? "warning" : "ok"} />
      </div>

      <Card title="Latest candidate feature detail">
        {lastWithClassification?.features ? (
          <table className="w-full text-xs">
            <tbody className="text-[var(--text)]">
              <Row label="AF7/AF8 correlation" value={agreementCorr?.toFixed(3) ?? "—"} />
              <Row label="AF7/AF8 amplitude ratio" value={agreementRatio?.toFixed(3) ?? "—"} />
              <Row label="Peak prominence (µV)" value={lastWithClassification.features.peakProminence.toFixed(1)} />
              <Row label="Duration (s)" value={lastWithClassification.features.durationS.toFixed(3)} />
              <Row label="Rejection reasons" value={lastWithClassification.classification?.rejectionReasons.join(", ") || "none"} />
            </tbody>
          </table>
        ) : (
          <div className="py-4 text-center text-sm text-[var(--text-dim)]">No candidate observed yet.</div>
        )}
      </Card>

      <Card title="Motion veto settings" actions={<Button variant="primary" onClick={apply}>Apply</Button>}>
        <p className="mb-3 text-xs text-[var(--text-dim)]">
          Uses the Muse accelerometer when available. This is a confidence penalty, not a hard veto, so legitimate
          blinking while moving is not automatically impossible (project brief section 8) — see docs/SAFETY.md
          "Known gaps" for why this matters.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
            Motion veto enabled
          </label>
          <Field label="Accel energy threshold (g²)" value={draft.accelEnergyThresholdG2} onChange={(v) => setDraft({ ...draft, accelEnergyThresholdG2: v })} />
          <Field label="Confidence penalty" value={draft.confidencePenalty} onChange={(v) => setDraft({ ...draft, confidencePenalty: v })} />
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="py-1 text-[var(--text-dim)]">{label}</td>
      <td className="py-1 text-right font-medium">{value}</td>
    </tr>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--text)]">{label}</span>
      <input
        type="number" value={value} step={0.01}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-40 rounded border border-[var(--border-strong)] bg-[var(--bg-panel-raised)] px-2 py-1 text-sm text-[var(--text-bright)]"
      />
    </label>
  );
}
