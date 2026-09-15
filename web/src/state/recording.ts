/**
 * Browser-side recording — port of the schema in utils/recorder.py
 * (project brief section 20). Recordings live only in memory/download;
 * nothing is ever uploaded anywhere (project brief section 5).
 */
import type { Command } from "../core/types";

export interface RecordRow {
  timestamp: number;
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
  "timestamp", "filtered_af7", "filtered_af8", "derived_frontal_signal", "signal_quality",
  "candidate_active", "classification_valid", "confidence", "state_event", "command",
];

export function rowsToCsv(rows: RecordRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.timestamp.toFixed(6), r.filteredAf7.toFixed(4), r.filteredAf8.toFixed(4), r.derivedFrontalSignal.toFixed(4),
        r.signalQuality.toFixed(3), r.candidateActive ? "1" : "0",
        r.classificationValid === null ? "" : r.classificationValid ? "1" : "0",
        r.confidence === null ? "" : r.confidence.toFixed(4), r.stateEvent, r.command,
      ].join(","),
    );
  }
  return lines.join("\n");
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
