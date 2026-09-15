import { useAppStore } from "../../state/appStore";
import { Card, StatTile } from "../common/Card";

export function Dashboard() {
  const museState = useAppStore((s) => s.museConnState);
  const esp32State = useAppStore((s) => s.esp32ConnState);
  const esp32Healthy = useAppStore((s) => s.esp32CommHealthy);
  const esp32Armed = useAppStore((s) => s.esp32OutputArmed);
  const mode = useAppStore((s) => s.mode);
  const fsHz = useAppStore((s) => s.fsHz);
  const recentResults = useAppStore((s) => s.recentResults);
  const latestCommand = useAppStore((s) => s.latestCommand);
  const latestConfidence = useAppStore((s) => s.latestConfidence);
  const recordedCount = useAppStore((s) => s.recordedRows.length);

  const last = recentResults[recentResults.length - 1];
  const quality = last ? Math.round(last.signalQuality.quality * 100) : null;
  const doubleBlinkState = last?.stateEvent?.eventType ?? null;

  const commandColor =
    latestCommand === "HOLD" ? "text-[var(--hold)]" : latestCommand === "OPEN" ? "text-[var(--ok)]" : "text-[var(--accent)]";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="System status" className="flex flex-col items-center justify-center py-8">
          <div className="text-xs uppercase tracking-widest text-[var(--text-dim)]">Current command</div>
          <div className={`mt-2 text-5xl font-extrabold ${commandColor}`}>{latestCommand}</div>
          <div className="mt-3 text-sm text-[var(--text-dim)]">
            {latestCommand === "HOLD"
              ? "Safe state — no double blink confirmed at high confidence, or a safety gate is active."
              : "Last resolved from a high-confidence DOUBLE_BLINK_CONFIRMED event."}
          </div>
        </Card>

        <Card title="Safety">
          <div className="flex items-center gap-3 py-4">
            <span
              className={`rounded-md px-3 py-1 text-sm font-bold ${
                esp32State === "connected" && esp32Armed ? "bg-[var(--warning)]/20 text-[var(--warning)]" : "bg-[var(--ok)]/15 text-[var(--ok)]"
              }`}
            >
              {esp32State === "connected" && esp32Armed ? "OUTPUT ARMED" : "SAFE / HOLD"}
            </span>
            <span className="text-xs text-[var(--text-dim)]">
              {esp32State !== "connected"
                ? "ESP32 not connected — commands cannot reach a physical hand."
                : esp32Armed
                  ? "Output is armed for this session. Commands other than HOLD will reach the ESP32."
                  : "ESP32 connected but output is not armed — see the ESP32 page."}
            </span>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Muse Connection" value={museState === "connected" ? "Connected" : museState === "connecting" ? "Connecting" : "Not connected"} tone={museState === "connected" ? "ok" : "neutral"} />
        <StatTile label="ESP32 Connection" value={esp32State === "connected" ? (esp32Healthy ? "Connected" : "No heartbeat") : "Not connected"} tone={esp32State === "connected" ? (esp32Healthy ? "ok" : "warning") : "neutral"} />
        <StatTile label="Mode" value={mode === "simulate" ? "Simulation" : mode === "live" ? "Live Muse 2" : "Replay"} />
        <StatTile label="Sample Rate" value={`${fsHz} Hz`} />
        <StatTile label="Signal Quality" value={quality !== null ? `${quality}%` : "—"} tone={quality === null ? "neutral" : quality >= 80 ? "ok" : quality >= 40 ? "warning" : "danger"} />
        <StatTile label="Confidence" value={latestConfidence !== null ? `${Math.round(latestConfidence * 100)}%` : "—"} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="AF7 Contact" value={quality !== null ? (quality >= 50 ? "Good" : "Poor") : "—"} sub="derived from combined AF7/AF8 monitor" tone={quality === null ? "neutral" : quality >= 50 ? "ok" : "danger"} />
        <StatTile label="AF8 Contact" value={quality !== null ? (quality >= 50 ? "Good" : "Poor") : "—"} sub="derived from combined AF7/AF8 monitor" tone={quality === null ? "neutral" : quality >= 50 ? "ok" : "danger"} />
        <StatTile label="TP9 Contact" value="Not monitored" sub="reference channel, not quality-gated" />
        <StatTile label="TP10 Contact" value="Not monitored" sub="reference channel, not quality-gated" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Motion Level" value={last?.classification?.componentScores.motion_veto_penalty_applied ? "Elevated" : "Low"} />
        <StatTile label="Blink Detector" value={last?.candidate ? "Candidate active" : "Idle"} />
        <StatTile label="Double-Blink State" value={doubleBlinkState ?? "IDLE"} />
        <StatTile label="Recorded Samples" value={recordedCount} />
      </div>
    </div>
  );
}
