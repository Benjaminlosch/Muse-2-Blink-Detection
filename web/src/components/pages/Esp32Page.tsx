import { useState } from "react";
import { appEngine } from "../../engine/appEngine";
import { useAppStore } from "../../state/appStore";
import { Card, StatTile } from "../common/Card";
import { Button } from "../common/Button";
import { Esp32Client } from "../../esp32/esp32Client";

export function Esp32Page() {
  const state = useAppStore((s) => s.esp32ConnState);
  const healthy = useAppStore((s) => s.esp32CommHealthy);
  const armed = useAppStore((s) => s.esp32OutputArmed);
  const lastCommand = useAppStore((s) => s.esp32LastCommandSent);
  const lastCommandTime = useAppStore((s) => s.esp32LastCommandTimeMs);
  const error = useAppStore((s) => s.esp32Error);
  const config = useAppStore((s) => s.config);
  const [busy, setBusy] = useState(false);
  const supported = Esp32Client.isSupported();

  async function connect() {
    setBusy(true);
    try {
      await appEngine.connectEsp32();
    } catch {
      /* surfaced via store.esp32Error */
    } finally {
      setBusy(false);
    }
  }

  async function testCommand(cmd: "OPEN" | "CLOSE" | "HOLD") {
    await appEngine.sendEsp32TestCommand(cmd);
  }

  return (
    <div className="flex flex-col gap-4">
      {!supported && (
        <Card className="border-[var(--warning)]">
          <p className="text-sm text-[var(--warning)]">
            Web Serial is not available in this browser. Open BCI Hand Configurator in Google Chrome or Microsoft
            Edge to connect an ESP32.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Connection" value={state === "connected" ? "Connected" : state === "connecting" ? "Connecting" : "Not connected"} tone={state === "connected" ? "ok" : "neutral"} />
        <StatTile label="Heartbeat" value={state === "connected" ? (healthy ? "OK" : "STALE") : "—"} tone={state === "connected" ? (healthy ? "ok" : "danger") : "neutral"} />
        <StatTile label="Baud rate" value={config.communication.baudRate} />
        <StatTile label="Last ACK" value={lastCommand ?? "—"} sub={lastCommandTime ? new Date(lastCommandTime).toLocaleTimeString() : undefined} />
      </div>

      {error && <div className="rounded bg-[var(--danger)]/15 px-3 py-2 text-xs text-[var(--danger)]">{error}</div>}

      <Card title="Connection">
        <div className="flex items-center gap-2">
          {state === "connected" ? (
            <Button onClick={() => appEngine.disconnectEsp32()}>Disconnect</Button>
          ) : (
            <Button variant="primary" disabled={busy || !supported} onClick={connect}>
              {busy ? "Connecting…" : "Connect"}
            </Button>
          )}
        </div>
      </Card>

      <Card title="Output arming">
        <p className="mb-3 text-xs text-[var(--text-dim)]">
          The system does not send movement-producing commands to the ESP32 until output has been deliberately
          enabled for this session (project brief section 22). Disconnecting automatically disarms output and
          returns the software command state to HOLD.
        </p>
        <div className="flex items-center gap-3">
          <span className={`rounded px-3 py-1 text-sm font-bold ${armed ? "bg-[var(--warning)]/20 text-[var(--warning)]" : "bg-[var(--bg-panel-raised)] text-[var(--text-dim)]"}`}>
            OUTPUT ARMED: {armed ? "YES" : "NO"}
          </span>
          <Button
            variant={armed ? "danger" : "primary"}
            disabled={state !== "connected"}
            onClick={() => appEngine.setEsp32OutputArmed(!armed)}
          >
            {armed ? "Disarm Output" : "Arm Output"}
          </Button>
        </div>
      </Card>

      <Card title="Manual test controls">
        <p className="mb-3 text-xs font-medium text-[var(--warning)]">
          ⚠ TEST OPEN / TEST CLOSE may cause physical movement of a connected hand mechanism, regardless of the
          output-armed toggle above. Follow docs/SAFETY.md's bench-test order before testing with a real motor
          attached.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={state !== "connected"} onClick={() => testCommand("HOLD")}>Send HOLD</Button>
          <Button variant="danger" disabled={state !== "connected"} onClick={() => testCommand("OPEN")}>Test OPEN</Button>
          <Button variant="danger" disabled={state !== "connected"} onClick={() => testCommand("CLOSE")}>Test CLOSE</Button>
        </div>
      </Card>
    </div>
  );
}
