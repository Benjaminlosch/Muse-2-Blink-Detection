import { useRef } from "react";
import { appEngine } from "../../engine/appEngine";
import { useAppStore } from "../../state/appStore";
import { downloadTextFile, parseCsvToRawSamples, rowsToCsv, rowsToJson } from "../../state/recording";
import { Card, StatTile } from "../common/Card";
import { Button } from "../common/Button";

export function Recorder() {
  const isRecording = useAppStore((s) => s.isRecording);
  const startRecording = useAppStore((s) => s.startRecording);
  const stopRecording = useAppStore((s) => s.stopRecording);
  const clearRecording = useAppStore((s) => s.clearRecording);
  const rows = useAppStore((s) => s.recordedRows);
  const mode = useAppStore((s) => s.mode);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function downloadCsv() {
    downloadTextFile(`bci-hand-recording-${Date.now()}.csv`, rowsToCsv(rows), "text/csv");
  }
  function downloadJson() {
    downloadTextFile(`bci-hand-recording-${Date.now()}.json`, rowsToJson(rows), "application/json");
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rawSamples = parseCsvToRawSamples(text);
    if (rawSamples.length === 0) {
      alert("Could not find af7/af8/tp9/tp10/timestamp columns in this CSV.");
      return;
    }
    appEngine.replaySamples(rawSamples);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Recording" value={isRecording ? "ACTIVE" : "stopped"} tone={isRecording ? "ok" : "neutral"} />
        <StatTile label="Rows captured" value={rows.length} />
        <StatTile label="Mode" value={mode} />
        <StatTile label="Duration" value={rows.length > 1 ? `${(rows[rows.length - 1].timestamp - rows[0].timestamp).toFixed(1)}s` : "—"} />
      </div>

      <Card title="Recording">
        <p className="mb-3 text-xs text-[var(--text-dim)]">
          Captures timestamp, raw + filtered AF7/AF8, derived frontal signal, IMU, signal quality, candidate/
          classification state, and the resolved command (project brief section 20). Nothing is ever uploaded —
          downloads happen entirely in your browser.
        </p>
        <div className="flex flex-wrap gap-2">
          {!isRecording ? (
            <Button variant="primary" onClick={startRecording}>Start Recording</Button>
          ) : (
            <Button variant="danger" onClick={stopRecording}>Stop Recording</Button>
          )}
          <Button disabled={rows.length === 0} onClick={downloadCsv}>Download CSV</Button>
          <Button disabled={rows.length === 0} onClick={downloadJson}>Download JSON</Button>
          <Button disabled={rows.length === 0} onClick={clearRecording}>Clear</Button>
        </div>
      </Card>

      <Card title="Replay a recording">
        <p className="mb-3 text-xs text-[var(--text-dim)]">
          Loads a previously downloaded CSV (or one from <code>scripts/record_data.py</code>) and replays its raw
          af7/af8/tp9/tp10 samples through the exact same pipeline used for live/simulated data.
        </p>
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChosen} className="text-xs text-[var(--text-dim)]" />
      </Card>
    </div>
  );
}
