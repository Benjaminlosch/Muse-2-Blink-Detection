import { useMemo, useState } from "react";
import { appEngine } from "../../engine/appEngine";
import { useAppStore } from "../../state/appStore";
import { Card, StatTile } from "../common/Card";
import { Button } from "../common/Button";

const STATES = ["IDLE", "BLINK_1_DETECTED", "WAITING_FOR_SECOND", "DOUBLE_BLINK_CONFIRMED", "REFRACTORY"] as const;

export function DoubleBlink() {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const recentResults = useAppStore((s) => s.recentResults);
  const [draft, setDraft] = useState(config.doubleBlink);

  const lastEvent = [...recentResults].reverse().find((r) => r.stateEvent !== null)?.stateEvent ?? null;
  const currentPhase: (typeof STATES)[number] = !lastEvent
    ? "IDLE"
    : lastEvent.eventType === "DOUBLE_BLINK_CONFIRMED"
      ? "DOUBLE_BLINK_CONFIRMED"
      : "IDLE";

  const recentDoubleBlinks = useMemo(
    () =>
      recentResults
        .filter((r) => r.stateEvent?.eventType === "DOUBLE_BLINK_CONFIRMED")
        .slice(-10)
        .reverse(),
    [recentResults],
  );

  function apply() {
    setConfig({ ...config, doubleBlink: draft });
    appEngine.applyConfig();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="State machine">
        <div className="flex flex-wrap items-center gap-2">
          {STATES.map((s) => (
            <div
              key={s}
              className={`rounded-md border px-3 py-2 text-xs font-medium ${
                s === currentPhase
                  ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--text-dim)]"
              }`}
            >
              {s.replace(/_/g, " ")}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-[var(--text-dim)]">
          Every blink shown here has already independently passed the full classifier — this state machine's only job
          is timing (project brief section 7). It is never "two threshold crossings."
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Min interval" value={`${(config.doubleBlink.minIntervalS * 1000).toFixed(0)} ms`} />
        <StatTile label="Max interval" value={`${(config.doubleBlink.maxIntervalS * 1000).toFixed(0)} ms`} />
        <StatTile label="Wait timeout" value={`${(config.doubleBlink.waitForSecondTimeoutS * 1000).toFixed(0)} ms`} />
        <StatTile label="Refractory" value={`${(config.doubleBlink.refractoryAfterDoubleS * 1000).toFixed(0)} ms`} />
      </div>

      <Card title="Recent double blinks">
        {recentDoubleBlinks.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--text-dim)]">No double blinks confirmed yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {recentDoubleBlinks.map((r, i) => {
              const ev = r.stateEvent!;
              return (
                <div key={i} className="flex items-center gap-3 rounded border border-[var(--border)] p-2 text-xs">
                  <span className="rounded bg-[var(--accent)]/15 px-2 py-0.5 font-semibold text-[var(--accent)]">DOUBLE BLINK</span>
                  <span className="text-[var(--text-dim)]">t={ev.timestampS.toFixed(3)}s</span>
                  <span className="text-[var(--text-dim)]">interval={ev.interBlinkIntervalS !== null ? `${(ev.interBlinkIntervalS * 1000).toFixed(0)}ms` : "—"}</span>
                  <span className="text-[var(--text-dim)]">confidence={Math.round(ev.confidence * 100)}%</span>
                  <span className="ml-auto font-semibold text-[var(--text-bright)]">{r.gateDecision.command}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Settings" actions={<Button variant="primary" onClick={apply}>Apply</Button>}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Min inter-blink interval (s)" value={draft.minIntervalS} onChange={(v) => setDraft({ ...draft, minIntervalS: v })} />
          <Field label="Max inter-blink interval (s)" value={draft.maxIntervalS} onChange={(v) => setDraft({ ...draft, maxIntervalS: v })} />
          <Field label="Wait-for-second timeout (s)" value={draft.waitForSecondTimeoutS} onChange={(v) => setDraft({ ...draft, waitForSecondTimeoutS: v })} />
          <Field label="Refractory after double (s)" value={draft.refractoryAfterDoubleS} onChange={(v) => setDraft({ ...draft, refractoryAfterDoubleS: v })} />
        </div>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--text)]">{label}</span>
      <input
        type="number" value={value} step={0.01}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded border border-[var(--border-strong)] bg-[var(--bg-panel-raised)] px-2 py-1 text-sm text-[var(--text-bright)]"
      />
    </label>
  );
}
