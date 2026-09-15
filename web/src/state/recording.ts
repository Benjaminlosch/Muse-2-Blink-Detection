/**
 * Browser-side recording — port of the schema in utils/recorder.py
 * (project brief section 20). Recordings live only in memory/download;
 * nothing is ever uploaded anywhere (project brief section 5).
 */
import type { Command } from "../core/types";

export interface RecordRow {
  timestamp: number;
  af7: number;
  af8: number;
  tp9: number;
  tp10: number;
  accelX: number | null;
  accelY: number | null;
  accelZ: number | null;
  filteredAf7: number;
  filteredAf8: number;
  derivedFrontalSignal: number;
  signalQuality: number;
  candidateActive: boolean;
  classificationValid: boolean | null;
  confidence: number | null;
  stateEvent: string;
  command: Command;
}

const CSV_HEADER = [
  "timestamp", "af7", "af8", "tp9", "tp10", "accel_x", "accel_y", "accel_z",
  "filtered_af7", "filtered_af8", "derived_frontal_signal", "signal_quality",
  "candidate_active", "classification_valid", "confidence", "state_event", "command",
];

export function rowsToCsv(rows: RecordRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.timestamp.toFixed(6), r.af7.toFixed(4), r.af8.toFixed(4), r.tp9.toFixed(4), r.tp10.toFixed(4),
        r.accelX ?? "", r.accelY ?? "", r.accelZ ?? "",
        r.filteredAf7.toFixed(4), r.filteredAf8.toFixed(4), r.derivedFrontalSignal.toFixed(4),
        r.signalQuality.toFixed(3), r.candidateActive ? "1" : "0",
        r.classificationValid === null ? "" : r.classificationValid ? "1" : "0",
        r.confidence === null ? "" : r.confidence.toFixed(4), r.stateEvent, r.command,
      ].join(","),
    );
  }
  return lines.join("\n");
}

/** Parses a CSV produced by rowsToCsv (or scripts/record_data.py's schema
 * closely enough for the raw af7/af8/tp9/tp10/accel columns) back into raw
 * samples suitable for replaying through the pipeline. */
export function parseCsvToRawSamples(csvText: string): Array<{
  timestampS: number; af7: number; af8: number; tp9: number; tp10: number;
  accelX: number | null; accelY: number | null; accelZ: number | null;
}> {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const idx = (name: string) => header.indexOf(name);
  const tIdx = idx("timestamp");
  const af7Idx = idx("af7");
  const af8Idx = idx("af8");
  const tp9Idx = idx("tp9");
  const tp10Idx = idx("tp10");
  const axIdx = idx("accel_x");
  const ayIdx = idx("accel_y");
  const azIdx = idx("accel_z");
  if (tIdx < 0 || af7Idx < 0 || af8Idx < 0 || tp9Idx < 0 || tp10Idx < 0) return [];

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < header.length) continue;
    const parseNullable = (s: string) => (s === "" ? null : Number(s));
    out.push({
      timestampS: Number(cols[tIdx]),
      af7: Number(cols[af7Idx]),
      af8: Number(cols[af8Idx]),
      tp9: Number(cols[tp9Idx]),
      tp10: Number(cols[tp10Idx]),
      accelX: axIdx >= 0 ? parseNullable(cols[axIdx]) : null,
      accelY: ayIdx >= 0 ? parseNullable(cols[ayIdx]) : null,
      accelZ: azIdx >= 0 ? parseNullable(cols[azIdx]) : null,
    });
  }
  return out;
}

export function rowsToJson(rows: RecordRow[]): string {
  return JSON.stringify(rows, null, 2);
}

/** Triggers a browser download of the given text content — never uploads
 * anywhere (project brief section 5/20: recordings stay local). */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
