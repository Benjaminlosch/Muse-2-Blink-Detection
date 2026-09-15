/**
 * Combines the Muse 2's four independently-notifying EEG characteristics
 * (TP9, AF7, AF8, TP10 — see protocol.ts) into aligned multi-channel
 * samples. Ported from the buffering strategy in urish/muse-js's
 * src/lib/zip-samples.ts (see protocol.ts's module docstring for source
 * verification): buffer readings that share the same group timestamp;
 * once a reading with a new timestamp arrives, the previous group is
 * complete and is flushed as N combined samples (N = samples per BLE
 * notification, 12 on the Muse 2).
 */
import { EEG_SAMPLE_RATE_HZ, EEG_SAMPLES_PER_NOTIFICATION } from "./protocol";

export interface ZippedEegSample {
  timestampMs: number;
  tp9: number;
  af7: number;
  af8: number;
  tp10: number;
}

interface PendingReading {
  samples: number[];
}

export class EegZipper {
  private readonly buffer = new Map<number, PendingReading>();
  private groupTimestampMs: number | null = null;

  /** electrodeIndex: 0=TP9, 1=AF7, 2=AF8, 3=TP10 (matches
   * protocol.EEG_CHANNEL_NAMES / EEG_CHARACTERISTIC_UUIDS order). AUX
   * (index 4) is intentionally never pushed here — this app doesn't use it. */
  push(electrodeIndex: number, groupTimestampMs: number, samples: number[], onSample: (s: ZippedEegSample) => void): void {
    if (this.groupTimestampMs !== null && groupTimestampMs !== this.groupTimestampMs) {
      this.flush(onSample);
    }
    this.groupTimestampMs = groupTimestampMs;
    this.buffer.set(electrodeIndex, { samples });
  }

  private flush(onSample: (s: ZippedEegSample) => void): void {
    if (this.buffer.size === 0 || this.groupTimestampMs === null) return;

    const tp9 = this.buffer.get(0)?.samples;
    const af7 = this.buffer.get(1)?.samples;
    const af8 = this.buffer.get(2)?.samples;
    const tp10 = this.buffer.get(3)?.samples;

    // Only emit combined samples once all four primary electrodes reported
    // for this group — a lone missed notification (rare, real BLE
    // unreliability) drops that group rather than feeding NaN into the
    // pipeline. WAITING FOR HARDWARE VERIFICATION: how often this
    // actually happens on a real link has not been measured.
    if (tp9 && af7 && af8 && tp10) {
      const msPerSample = 1000 / EEG_SAMPLE_RATE_HZ;
      for (let i = 0; i < EEG_SAMPLES_PER_NOTIFICATION; i++) {
        onSample({
          timestampMs: this.groupTimestampMs + i * msPerSample,
          tp9: tp9[i],
          af7: af7[i],
          af8: af8[i],
          tp10: tp10[i],
        });
      }
    }

    this.buffer.clear();
  }

  reset(): void {
    this.buffer.clear();
    this.groupTimestampMs = null;
  }
}
