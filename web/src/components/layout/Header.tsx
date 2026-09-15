import { useState } from "react";
import { appEngine } from "../../engine/appEngine";
import { useAppStore } from "../../state/appStore";
import { StatusDot, type StatusTone } from "../common/StatusDot";
import { Button } from "../common/Button";

function museTone(state: string): StatusTone {
  if (state === "connected") return "ok";
  if (state === "connecting") return "warning";
  return "neutral";
}

export function Header() {
  const museState = useAppStore((s) => s.museConnState);
  const museDevice = useAppStore((s) => s.museDeviceName);
  const museBattery = useAppStore((s) => s.museBatteryPercent);
  const mode = useAppStore((s) => s.mode);
  const fsHz = useAppStore((s) => s.fsHz);
  const esp32State = useAppStore((s) => s.esp32ConnState);
  const esp32Healthy = useAppStore((s) => s.esp32CommHealthy);
  const isRecording = useAppStore((s) => s.isRecording);
  const startRecording = useAppStore((s) => s.startRecording);
  const stopRecording = useAppStore((s) => s.stopRecording);

  const [busy, setBusy] = useState<"muse" | "esp32" | null>(null);

  async function handleMuseClick() {
    if (museState === "connected") {
      await appEngine.disconnectMuse();
      return;
    }
    setBusy("muse");
    try {
      await appEngine.connectMuse();
    } catch {
      /* surfaced via store.museError */
    } finally {
      setBusy(null);
    }
  }

  async function handleEsp32Click() {
    if (esp32State === "connected") {
      await appEngine.disconnectEsp32();
      return;
    }
    setBusy("esp32");
    try {
      await appEngine.connectEsp32();
    } catch {
      /* surfaced via store.esp32Error */
    } finally {
      setBusy(null);
    }
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[var(--border)] bg-[var(--bg-panel)] px-4">
      <div className="flex items-center gap-2 pr-2">
        <div className="h-6 w-6 rounded bg-[var(--accent-strong)]" />
        <span className="text-sm font-bold tracking-wide text-[var(--text-bright)]">BCI HAND</span>
      </div>

      <div className="h-6 w-px bg-[var(--border-strong)]" />

      {/* Muse 2 status */}
      <div className="flex items-center gap-2">
        <StatusDot tone={museTone(museState)} pulse={museState === "connecting"} />
        <div className="leading-tight">
          <div className="text-xs font-medium text-[var(--text-bright)]">
            MUSE 2 {museState === "connected" && museDevice ? `— ${museDevice}` : ""}
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">
            {mode === "simulate" ? "Simulation" : museState === "connected" ? `${fsHz} Hz` : "Not connected"}
            {museBattery !== null && museState === "connected" ? ` · Battery ${Math.round(museBattery)}%` : ""}
          </div>
        </div>
        <Button variant={museState === "connected" ? "secondary" : "primary"} disabled={busy === "muse"} onClick={handleMuseClick}>
          {museState === "connected" ? "Disconnect" : busy === "muse" ? "Connecting…" : "Connect Muse 2"}
        </Button>
      </div>

      <div className="h-6 w-px bg-[var(--border-strong)]" />

      {/* ESP32 status */}
      <div className="flex items-center gap-2">
        <StatusDot tone={esp32State === "connected" ? (esp32Healthy ? "ok" : "warning") : "neutral"} pulse={esp32State === "connecting"} />
        <div className="leading-tight">
          <div className="text-xs font-medium text-[var(--text-bright)]">ESP32</div>
          <div className="text-[11px] text-[var(--text-dim)]">
            {esp32State === "connected" ? (esp32Healthy ? "Heartbeat OK" : "No heartbeat") : "Not connected"}
          </div>
        </div>
        <Button variant="secondary" disabled={busy === "esp32"} onClick={handleEsp32Click}>
          {esp32State === "connected" ? "Disconnect" : busy === "esp32" ? "Connecting…" : "Connect ESP32"}
        </Button>
      </div>

      <div className="flex-1" />

      <Button variant={isRecording ? "danger" : "secondary"} onClick={() => (isRecording ? stopRecording() : startRecording())}>
        {isRecording ? "● Recording — Stop" : "Start Recording"}
      </Button>
    </header>
  );
}
