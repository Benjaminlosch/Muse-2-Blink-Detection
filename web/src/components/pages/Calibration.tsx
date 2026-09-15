import { useEffect, useMemo, useRef, useState } from "react";
import { appEngine } from "../../engine/appEngine";
import { CausalBlinkBandFilter } from "../../core/dsp/filters";
import { computeCalibrationStats, deriveConfigOverrides, type TrialSegment } from "../../core/detection/calibration";
import { mergeConfig } from "../../core/config";
import type { CalibrationStats } from "../../core/types";
import { useAppStore } from "../../state/appStore";
import { Card } from "../common/Card";
import { Button } from "../common/Button";
import { loadCalibrationFromStorage, saveCalibrationToStorage } from "../../state/calibrationStorage";

type StepLabel = "REST" | "SINGLE_BLINK" | "DOUBLE_BLINK";

interface Step {
  label: StepLabel;
  durationS: number;
  instruction: string;
}

function buildSteps(config: ReturnType<typeof useAppStore.getState>["config"]): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i < config.calibration.restTrials; i++) {
    steps.push({ label: "REST", durationS: config.calibration.restTrialDurationS, instruction: "Sit still and relax. Try not to blink." });
  }
  for (let i = 0; i < config.calibration.singleBlinkTrials; i++) {
    steps.push({ label: "SINGLE_BLINK", durationS: 2.5, instruction: "Blink once, deliberately, when the countdown reaches GO." });
  }
  for (let i = 0; i < config.calibration.doubleBlinkTrials; i++) {
    steps.push({ label: "DOUBLE_BLINK", durationS: 3.0, instruction: "Perform one deliberate FAST DOUBLE BLINK when the countdown reaches GO." });
  }
  return steps;
}

export function Calibration() {
  const config = useAppStore((s) => s.config);
  const fsHz = useAppStore((s) => s.fsHz);
  const setCalibrationStats = useAppStore((s) => s.setCalibrationStats);
  const setConfig = useAppStore((s) => s.setConfig);

  const steps = useMemo(() => buildSteps(config), [config]);
  const [stepIdx, setStepIdx] = useState(-1); // -1 = not started
  const [phase, setPhase] = useState<"idle" | "countdown" | "recording" | "done">("idle");
  const [countdown, setCountdown] = useState(3);
  const trialsRef = useRef<TrialSegment[]>([]);
  const trialStartRef = useRef<number>(0);
  const [resultStats, setResultStats] = useState<CalibrationStats | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      setPhase("recording");
      trialStartRef.current = useAppStore.getState().recentRawSamples.at(-1)?.timestampS ?? 0;
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  useEffect(() => {
    if (phase !== "recording") return;
    const step = steps[stepIdx];
    const t = setTimeout(() => finishTrial(step), step.durationS * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function finishTrial(step: Step) {
    const endT = useAppStore.getState().recentRawSamples.at(-1)?.timestampS ?? 0;
    const startT = trialStartRef.current;
    const samples = useAppStore.getState().recentRawSamples.filter((s) => s.timestampS >= startT && s.timestampS <= endT);

    if (samples.length > 4) {
      const af7Filter = new CausalBlinkBandFilter(fsHz, config.dsp.baselineTrackerTimeConstantS, config.dsp.notchEnabled);
      const af8Filter = new CausalBlinkBandFilter(fsHz, config.dsp.baselineTrackerTimeConstantS, config.dsp.notchEnabled);
      const af7 = new Float64Array(samples.length);
      const af8 = new Float64Array(samples.length);
      const frontal = new Float64Array(samples.length);
      samples.forEach((s, i) => {
        af7[i] = af7Filter.processSample(s.af7);
        af8[i] = af8Filter.processSample(s.af8);
        frontal[i] = (af7[i] + af8[i]) / 2;
      });
      trialsRef.current.push({ label: step.label, frontal, af7, af8 });
    }

    const next = stepIdx + 1;
    if (next >= steps.length) {
      finishWizard();
    } else {
      setStepIdx(next);
      setCountdown(3);
      setPhase("countdown");
    }
  }

  function finishWizard() {
    const stats = computeCalibrationStats(trialsRef.current, fsHz);
    setResultStats(stats);
    setPhase("done");
    const expectedSingle = config.calibration.singleBlinkTrials;
    const expectedDouble = config.calibration.doubleBlinkTrials;
    if (stats.nSingleCandidates < expectedSingle || stats.nDoublePairs < expectedDouble) {
      setWarning(
        `Not every trial produced a detected blink (single: ${stats.nSingleCandidates}/${expectedSingle}, double: ${stats.nDoublePairs}/${expectedDouble}). Thresholds derived from this run may be unreliable — consider retrying with clearer, more deliberate blinks.`,
      );
    } else {
      setWarning(null);
    }
  }

  function start() {
    trialsRef.current = [];
    setResultStats(null);
    setWarning(null);
    setStepIdx(0);
    setCountdown(3);
    setPhase("countdown");
  }

  function save() {
    if (!resultStats) return;
    const overrides = deriveConfigOverrides(resultStats);
    setCalibrationStats(resultStats);
    setConfig(mergeConfig(config, overrides));
    appEngine.applyCalibration();
    appEngine.applyConfig();
    saveCalibrationToStorage(resultStats, overrides);
    setPhase("idle");
    setStepIdx(-1);
  }

  function discard() {
    setResultStats(null);
    setPhase("idle");
    setStepIdx(-1);
  }

  function loadSaved() {
    const saved = loadCalibrationFromStorage();
    if (!saved) return;
    setCalibrationStats(saved.stats);
    setConfig(mergeConfig(config, saved.overrides));
    appEngine.applyCalibration();
    appEngine.applyConfig();
  }

  const acquiring = useAppStore((s) => s.museConnState === "connected" || s.mode === "simulate");

  return (
    <div className="flex flex-col gap-4">
      <Card title="Guided calibration">
        <p className="mb-3 text-xs text-[var(--text-dim)]">
          Runs REST → SINGLE BLINK → DOUBLE BLINK trials and derives robust (median/MAD) thresholds from your own
          data — see docs/CALIBRATION.md. A deliberate single blink and a spontaneous one look too similar to trust on
          their own, which is why this system's only control signal is the double blink.
        </p>

        {phase === "idle" && (
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={start} disabled={!acquiring}>
              Start Calibration ({steps.length} trials)
            </Button>
            <Button onClick={loadSaved}>Load Saved Calibration</Button>
            {!acquiring && <span className="text-xs text-[var(--text-dim)]">Connect a Muse 2 or start Simulation Mode first.</span>}
          </div>
        )}

        {(phase === "countdown" || phase === "recording") && stepIdx >= 0 && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-[var(--border)] py-10">
            <div className="text-xs uppercase tracking-widest text-[var(--text-dim)]">
              Step {stepIdx + 1} / {steps.length} — {steps[stepIdx].label.replace("_", " ")}
            </div>
            <div className="text-lg text-[var(--text)]">{steps[stepIdx].instruction}</div>
            {phase === "countdown" ? (
              <div className="text-6xl font-extrabold text-[var(--accent)]">{countdown > 0 ? countdown : "GO"}</div>
            ) : (
              <div className="text-2xl font-bold text-[var(--ok)]">Recording…</div>
            )}
          </div>
        )}

        {phase === "done" && resultStats && (
          <div className="flex flex-col gap-3">
            {warning && <div className="rounded bg-[var(--warning)]/15 px-3 py-2 text-xs text-[var(--warning)]">{warning}</div>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <ResultTile label="Baseline" value={resultStats.baselineMedian.toFixed(2)} sub="µV median" />
              <ResultTile label="Noise floor MAD" value={resultStats.noiseFloorMad.toFixed(2)} sub="µV" />
              <ResultTile label="Blink amplitude" value={resultStats.intentionalBlinkPeakMedian.toFixed(1)} sub="µV median" />
              <ResultTile label="Blink duration" value={`${(resultStats.intentionalDurationMedianS * 1000).toFixed(0)} ms`} />
              <ResultTile label="Double-blink interval" value={resultStats.nDoublePairs > 0 ? `${(resultStats.doubleBlinkSpacingMedianS * 1000).toFixed(0)} ms` : "—"} />
              <ResultTile label="Trials used" value={`${resultStats.nSingleCandidates}/${config.calibration.singleBlinkTrials} single, ${resultStats.nDoublePairs}/${config.calibration.doubleBlinkTrials} double`} />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={save}>Save Calibration</Button>
              <Button onClick={start}>Retry</Button>
              <Button variant="danger" onClick={discard}>Discard</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function ResultTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel-raised)] p-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-[var(--text-bright)]">{value}</div>
      {sub && <div className="text-xs text-[var(--text-dim)]">{sub}</div>}
    </div>
  );
}
