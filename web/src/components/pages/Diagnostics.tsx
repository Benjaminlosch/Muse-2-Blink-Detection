import { useMemo } from "react";
import { checkBrowserCompatibility } from "../../muse/museClient";
import { useAppStore } from "../../state/appStore";
import { downloadTextFile } from "../../state/recording";
import { Card, StatTile } from "../common/Card";
import { Button } from "../common/Button";

export function Diagnostics() {
  const compat = checkBrowserCompatibility();
  const recentResults = useAppStore((s) => s.recentResults);
  const recentRawSamples = useAppStore((s) => s.recentRawSamples);
  const latencySummary = useAppStore((s) => s.latencySummary);
  const log = useAppStore((s) => s.diagnosticsLog);
  const esp32Healthy = useAppStore((s) => s.esp32CommHealthy);
  const esp32LastCommandTime = useAppStore((s) => s.esp32LastCommandTimeMs);

  const channelStats = useMemo(() => {
    const stat = (values: number[]) => {
      if (values.length === 0) return { min: NaN, max: NaN, mean: NaN };
      const min = Math.min(...values);
      const max = Math.max(...values);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      return { min, max, mean };
    };
    return {
      af7: stat(recentRawSamples.map((s) => s.af7)),
      af8: stat(recentRawSamples.map((s) => s.af8)),
      tp9: stat(recentRawSamples.map((s) => s.tp9)),
      tp10: stat(recentRawSamples.map((s) => s.tp10)),
    };
  }, [recentRawSamples]);

  function downloadLog() {
    downloadTextFile(`bci-hand-diagnostics-${Date.now()}.log`, log.join("\n"), "text/plain");
  }

  const heartbeatAgeS = esp32LastCommandTime !== null ? (Date.now() - esp32LastCommandTime) / 1000 : null;

  return (
    <div className="flex flex-col gap-4">
      <Card title="Browser compatibility">
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Secure Context" value={compat.isSecureContext ? "YES" : "NO"} tone={compat.isSecureContext ? "ok" : "danger"} />
          <StatTile label="Bluetooth API" value={compat.bluetoothAvailable ? "AVAILABLE" : "UNAVAILABLE"} tone={compat.bluetoothAvailable ? "ok" : "danger"} />
          <StatTile label="Serial API" value={compat.serialAvailable ? "AVAILABLE" : "UNAVAILABLE"} tone={compat.serialAvailable ? "ok" : "danger"} />
        </div>
      </Card>

      <Card title="Channel sample statistics (current window)">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--text-dim)]">
              <th className="pb-1">Channel</th><th className="pb-1">Min</th><th className="pb-1">Max</th><th className="pb-1">Mean</th>
            </tr>
          </thead>
          <tbody className="text-[var(--text)]">
            {(Object.keys(channelStats) as Array<keyof typeof channelStats>).map((ch) => (
              <tr key={ch} className="border-t border-[var(--border)]">
                <td className="py-1 uppercase">{ch}</td>
                <td className="py-1">{channelStats[ch].min.toFixed(2)}</td>
                <td className="py-1">{channelStats[ch].max.toFixed(2)}</td>
                <td className="py-1">{channelStats[ch].mean.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Pipeline latency (worker, per stage)">
        {Object.keys(latencySummary).length === 0 ? (
          <div className="py-4 text-center text-sm text-[var(--text-dim)]">No timed events yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--text-dim)]">
                <th className="pb-1">Stage</th><th className="pb-1">n</th><th className="pb-1">mean (ms)</th><th className="pb-1">p95 (ms)</th><th className="pb-1">max (ms)</th>
              </tr>
            </thead>
            <tbody className="text-[var(--text)]">
              {Object.entries(latencySummary).map(([stage, stats]) => (
                <tr key={stage} className="border-t border-[var(--border)]">
                  <td className="py-1">{stage}</td>
                  <td className="py-1">{stats.n}</td>
                  <td className="py-1">{stats.meanMs.toFixed(3)}</td>
                  <td className="py-1">{stats.p95Ms.toFixed(3)}</td>
                  <td className="py-1">{stats.maxMs.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Results in buffer" value={recentResults.length} />
        <StatTile label="ESP32 heartbeat age" value={heartbeatAgeS !== null ? `${heartbeatAgeS.toFixed(1)}s` : "—"} tone={esp32Healthy ? "ok" : "neutral"} />
      </div>

      <Card title="Diagnostic log" actions={<Button onClick={downloadLog} disabled={log.length === 0}>Download Log</Button>}>
        <div className="max-h-64 overflow-y-auto rounded bg-[var(--bg-panel-raised)] p-2 font-mono text-[11px] text-[var(--text-dim)]">
          {log.length === 0 ? <div className="p-2">No events logged yet.</div> : log.slice(-200).map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </Card>
    </div>
  );
}
