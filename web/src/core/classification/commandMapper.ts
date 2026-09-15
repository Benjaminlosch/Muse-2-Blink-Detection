/**
 * Blink-event -> hand command mapping — port of
 * classification/command_mapper.py. Configurable, not hard-coded: only
 * DOUBLE_BLINK_CONFIRMED maps to anything by default (a toggle between
 * OPEN and CLOSE); everything else resolves to HOLD.
 */
import type { Command } from "../types";

export class HandStateTracker {
  private lastCommandedValue: Command | null = null;

  get lastCommanded(): Command | null {
    return this.lastCommandedValue;
  }

  toggle(): Command {
    const next: Command = this.lastCommandedValue === "OPEN" ? "CLOSE" : "OPEN";
    this.lastCommandedValue = next;
    return next;
  }

  reset(): void {
    this.lastCommandedValue = null;
  }

  /** Only used by resolveCommandMapping for the explicit OPEN/CLOSE path. */
  setLastCommanded(command: Command): void {
    this.lastCommandedValue = command;
  }
}

/** intent keys match BciConfig.communication.commandMapping's own field
 * names (camelCase) — NOT Python's snake_case YAML keys. The `mapping`
 * object passed in is that config substructure directly. */
export function resolveCommandMapping(
  intent: "doubleBlink" | "singleBlink" | "uncertain",
  mapping: Record<string, string>,
  handState: HandStateTracker,
): Command {
  const mapped = mapping[intent] ?? "HOLD";
  if (mapped === "TOGGLE_OPEN_CLOSE") return handState.toggle();
  if (mapped === "OPEN" || mapped === "CLOSE") {
    handState.setLastCommanded(mapped);
    return mapped;
  }
  return "HOLD";
}
