import { useMemo, useState } from "react";
import { appEngine } from "../../engine/appEngine";
import { useAppStore } from "../../state/appStore";
import { useWindowedResults } from "../../hooks/useWindowedResults";
import { Card, StatTile } from "../common/Card";
import { Button } from "../common/Button";
import { ScrollingLineChart } from "../charts/ScrollingLineChart";

export function BlinkDetector() {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const recentResults = useAppStore((s) => s.recentResults);
  const [draft, setDraft] = useState(config.candidateDetection);
  const [spatialDraft, setSpatialDraft] = useState(config.spatial);

  const { results } = useWindowedResults(10);
  const timestamps = results.map((r) => r.timestampS);
  const frontal = results.map((r) => r.frontalSignal);
  const threshold = results.map((r) => r.adaptiveThreshold);
  const negThreshold = threshold.map((v) => -v);

  const stats = useMemo(() => {
    const candidates = recentResults.filter((r) => r.candidate !== null);
    const accepted = candidates.filter((r) => r.classification?.isValidBlink);
    const rejected = candidates.filter((r) => r.classification && !r.classification.isValidBlink);
    const last = recentResults[recentResults.length - 1];
    const lastRejected = [...recentResults].reverse().find((r) => r.classification && !r.classification.isValidBlink);
    return {
      candidateCount: candidates.length,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      currentThreshold: last?.adaptiveThreshold ?? null,
      lastConfidence: [...recentResults].reverse().find((r) => r.classification?.isValidBlink)?.classification?.confidence ?? null,
      lastRejectionReasons: lastRejected?.classification?.rejectionReasons ?? [],
    };
  }, [recentResults]);

  function apply() {
    setConfig({ ...config, candidateDetection: draft, spatial: spatialDraft });
    appEngine.applyConfig();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Candidates" value={stats.candidateCount} />
        <StatTile label="Accepted" value={stats.acceptedCount} tone="ok" />
        <StatTile label="Rejected" value={stats.rejectedCount} tone="danger" />
        <StatTile label="Current Threshold" value={stats.currentThreshold !== null ? stats.currentThreshold.toFixed(1) : "—"} sub="µV" />
        <StatTile label="Latest Confidence" value={stats.lastConfidence !== null ? `${Math.round(stats.lastConfidence * 100)}%` : "—"} />
        <StatTile label="Last Rejection" value={stats.lastRejectionReasons[0] ?? "none"} tone={stats.lastRejectionReasons.length ? "warning" : "neutral"} />
      </div>

      <Card title="Threshold overlay">
        {results.length > 0 ? (
          <ScrollingLineChart
            timestamps={timestamps}
            series={[
              { label: "frontal_mean", color: "#4fd1c5", values: frontal, width: 1.5 },
              { label: "+threshold", color: "#f5a524", values: threshold, width: 1, dash: [4, 3] },
              { label: "-threshold", color: "#f5a524", values: negThreshold, width: 1, dash: [4, 3] },
            ]}
            height={220}
            yLabel="µV"
          />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-[var(--text-dim)]">No data yet.</div>
        )}
      </Card>

      <Card title="Detector settings" actions={<Button variant="primary" onClick={apply}>Apply</Button>}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field label="Threshold MAD multiplier" value={draft.thresholdMadMultiplier} onChange={(v) => setDraft({ ...draft, thresholdMadMultiplier: v })} />
          <Field label="Min prominence (µV)" value={draft.minProminenceUv} onChange={(v) => setDraft({ ...draft, minProminenceUv: v })} />
          <Field label="Min blink duration (s)" value={draft.minBlinkWidthS} step={0.01} onChange={(v) => setDraft({ ...draft, minBlinkWidthS: v })} />
          <Field label="Max blink duration (s)" value={draft.maxBlinkWidthS} step={0.01} onChange={(v) => setDraft({ ...draft, maxBlinkWidthS: v })} />
          <Field label="Refractory (s)" value={draft.refractoryAfterCandidateS} step={0.01} onChange={(v) => setDraft({ ...draft, refractoryAfterCandidateS: v })} />
          <Field label="Rebound guard (s)" value={draft.reboundGuardS} step={0.01} onChange={(v) => setDraft({ ...draft, reboundGuardS: v })} />
          <Field label="AF7/AF8 min correlation" value={spatialDraft.af7Af8MinCorrelation} step={0.05} min={0} max={1} onChange={(v) => setSpatialDraft({ ...spatialDraft, af7Af8MinCorrelation: v })} />
          <Field label="AF7/AF8 max amplitude ratio" value={spatialDraft.af7Af8MaxAmplitudeRatio} step={0.1} onChange={(v) => setSpatialDraft({ ...spatialDraft, af7Af8MaxAmplitudeRatio: v })} />
        </div>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange, step = 0.1, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--text)]">{label}</span>
      <input
        type="number" value={value} step={step} min={min} max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded border border-[var(--border-strong)] bg-[var(--bg-panel-raised)] px-2 py-1 text-sm text-[var(--text-bright)]"
      />
    </label>
  );
}
