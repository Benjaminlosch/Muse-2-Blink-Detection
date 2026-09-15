/**
 * Single/double-blink temporal state machine — port of
 * classification/state_machine.py. Every blink fed in here must already
 * have independently passed the full classifier; this module's only job is
 * timing/debounce/refractory logic. See that file's module docstring.
 */
import type { BlinkStateMachineEvent } from "../types";

type FsmState = "IDLE" | "WAIT_FOR_SECOND" | "REFRACTORY";

export interface DoubleBlinkStateMachineOptions {
  minIntervalS?: number;
  maxIntervalS?: number;
  waitForSecondTimeoutS?: number;
  refractoryAfterDoubleS?: number;
  emitSingleOnTimeout?: boolean;
}

export class DoubleBlinkStateMachine {
  private readonly minIntervalS: number;
  private readonly maxIntervalS: number;
  private readonly waitForSecondTimeoutS: number;
  private readonly refractoryAfterDoubleS: number;
  private readonly emitSingleOnTimeout: boolean;

  private state: FsmState = "IDLE";
  private firstBlinkTime: number | null = null;
  private firstBlinkConfidence = 0;
  private refractoryUntil: number | null = null;

  constructor(options: DoubleBlinkStateMachineOptions = {}) {
    this.minIntervalS = options.minIntervalS ?? 0.08;
    this.maxIntervalS = options.maxIntervalS ?? 0.6;
    this.waitForSecondTimeoutS = options.waitForSecondTimeoutS ?? 0.7;
    this.refractoryAfterDoubleS = options.refractoryAfterDoubleS ?? 0.5;
    this.emitSingleOnTimeout = options.emitSingleOnTimeout ?? true;
  }

  get currentState(): FsmState {
    return this.state;
  }

  /** Call periodically (or before processing the next blink) so a
   * WAIT_FOR_SECOND timeout can resolve to a single-blink event even if no
   * further blink ever arrives. */
  pollTimeout(nowS: number): BlinkStateMachineEvent | null {
    if (this.state === "WAIT_FOR_SECOND" && this.firstBlinkTime !== null) {
      if (nowS - this.firstBlinkTime > this.waitForSecondTimeoutS) {
        let event: BlinkStateMachineEvent | null = null;
        if (this.emitSingleOnTimeout) {
          event = {
            eventType: "SINGLE_BLINK_CONFIRMED",
            timestampS: nowS,
            firstBlinkTimestampS: this.firstBlinkTime,
            secondBlinkTimestampS: null,
            interBlinkIntervalS: null,
            confidence: this.firstBlinkConfidence,
          };
        }
        this.toIdle();
        return event;
      }
    }

    if (this.state === "REFRACTORY" && this.refractoryUntil !== null) {
      if (nowS >= this.refractoryUntil) {
        this.state = "IDLE";
        this.refractoryUntil = null;
      }
    }

    return null;
  }

  /** Feed one already-validated blink event's timestamp and confidence.
   * Returns a confirmed event if this blink completes one. */
  processValidBlink(timestampS: number, confidence: number): BlinkStateMachineEvent | null {
    this.pollTimeout(timestampS);

    if (this.state === "REFRACTORY") {
      return null;
    }

    if (this.state === "IDLE") {
      this.state = "WAIT_FOR_SECOND";
      this.firstBlinkTime = timestampS;
      this.firstBlinkConfidence = confidence;
      return null;
    }

    if (this.state === "WAIT_FOR_SECOND") {
      const first = this.firstBlinkTime as number;
      const interval = timestampS - first;

      if (interval < this.minIntervalS) {
        return null; // ringing/bounce from the same physical blink
      }

      if (interval <= this.maxIntervalS) {
        const event: BlinkStateMachineEvent = {
          eventType: "DOUBLE_BLINK_CONFIRMED",
          timestampS,
          firstBlinkTimestampS: first,
          secondBlinkTimestampS: timestampS,
          interBlinkIntervalS: interval,
          confidence: Math.min(this.firstBlinkConfidence, confidence),
        };
        this.state = "REFRACTORY";
        this.refractoryUntil = timestampS + this.refractoryAfterDoubleS;
        this.firstBlinkTime = null;
        return event;
      }

      // Too slow to be a double blink: start a fresh sequence with this blink.
      this.firstBlinkTime = timestampS;
      this.firstBlinkConfidence = confidence;
      return null;
    }

    return null;
  }

  private toIdle(): void {
    this.state = "IDLE";
    this.firstBlinkTime = null;
    this.firstBlinkConfidence = 0;
  }

  reset(): void {
    this.toIdle();
    this.refractoryUntil = null;
  }
}
