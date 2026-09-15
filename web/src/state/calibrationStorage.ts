/**
 * Calibration persistence — localStorage only (project brief section 19:
 * "Store saved calibration in browser storage such as IndexedDB/
 * localStorage"; no account required, nothing uploaded anywhere).
 */
import type { DeepPartial, BciConfig } from "../core/config";
import type { CalibrationStats } from "../core/types";

const STORAGE_KEY = "bci-hand.calibration.v1";

export interface StoredCalibration {
  stats: CalibrationStats;
  overrides: DeepPartial<BciConfig>;
  savedAtIso: string;
}

export function saveCalibrationToStorage(stats: CalibrationStats, overrides: DeepPartial<BciConfig>): void {
  const record: StoredCalibration = { stats, overrides, savedAtIso: new Date().toISOString() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* private browsing / storage disabled — calibration simply won't persist across reloads */
  }
}

export function loadCalibrationFromStorage(): StoredCalibration | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredCalibration;
  } catch {
    return null;
  }
}

export function clearCalibrationStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function exportCalibrationJson(stats: CalibrationStats, overrides: DeepPartial<BciConfig>): string {
  return JSON.stringify({ stats, overrides, exportedAtIso: new Date().toISOString() }, null, 2);
}
