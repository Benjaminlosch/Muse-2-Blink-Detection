import { useAppStore, type PageId } from "../../state/appStore";

const NAV_ITEMS: Array<{ id: PageId; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "liveEeg", label: "Live EEG" },
  { id: "filters", label: "Filters" },
  { id: "blinkDetector", label: "Blink Detector" },
  { id: "doubleBlink", label: "Double Blink" },
  { id: "artifactRejection", label: "Artifact Rejection" },
  { id: "calibration", label: "Calibration" },
  { id: "commands", label: "Commands" },
  { id: "esp32", label: "ESP32" },
  { id: "recorder", label: "Recorder / Replay" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "settings", label: "Settings" },
  { id: "about", label: "About / Docs" },
];

export function LeftNav() {
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);
  const command = useAppStore((s) => s.latestCommand);

  return (
    <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-[var(--border)] bg-[var(--bg-panel)] p-2">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          onClick={() => setPage(item.id)}
          className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
            page === item.id
              ? "bg-[var(--bg-hover)] text-[var(--text-bright)] font-medium"
              : "text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          }`}
        >
          {item.label}
        </button>
      ))}

      <div className="flex-1" />

      <div className="rounded-md border border-[var(--border)] p-3 text-center">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-dim)]">Command</div>
        <div
          className={`mt-1 text-lg font-bold ${
            command === "HOLD" ? "text-[var(--hold)]" : command === "OPEN" ? "text-[var(--ok)]" : "text-[var(--accent)]"
          }`}
        >
          {command}
        </div>
      </div>
    </nav>
  );
}
