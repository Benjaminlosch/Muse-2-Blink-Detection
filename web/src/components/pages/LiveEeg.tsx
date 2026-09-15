import { useState } from "react";
import { useWindowedResults } from "../../hooks/useWindowedResults";
import { Card } from "../common/Card";
import { ScrollingLineChart, type ChartSeries } from "../charts/ScrollingLineChart";

type ViewMode = "raw" | "filtered" | "both";
const WINDOWS = [2, 5, 10, 20];

export function LiveEeg() {
  const [windowS, setWindowS] = useState(10);
  const [viewMode, setViewMode] = useState<ViewMode>("filtered");
  const [showCombined, setShowCombined] = useState(true);

  const { results, rawSamples } = useWindowedResults(windowS);
  const timestamps = results.map((r) => r.timestampS);

  const rawAf7 = rawSamples.map((s) => s.af7);
  const rawAf8 = rawSamples.map((s) => s.af8);
  const rawTp9 = rawSamples.map((s) => s.tp9);
  const rawTp10 = rawSamples.map((s) => s.tp10);
  const filteredAf7 = results.map((r) => r.filteredAf7);
  const filteredAf8 = results.map((r) => r.filteredAf8);
  const frontalMean = results.map((r) => r.frontalSignal);
  const frontalDiff = filteredAf7.map((v, i) => v - filteredAf8[i]);

  const channelSeries: ChartSeries[] = [];
  if (viewMode === "raw" || viewMode === "both") {
    channelSeries.push(
      { label: "AF7 (raw)", color: "#4fd1c5", values: rawAf7, width: 1 },
      { label: "AF8 (raw)", color: "#f5a524", values: rawAf8, width: 1 },
      { label: "TP9 (raw)", color: "#7d8598", values: rawTp9, width: 1, dash: [4, 3] },
      { label: "TP10 (raw)", color: "#5b6478", values: rawTp10, width: 1, dash: [4, 3] },
    );
  }
  if (viewMode === "filtered" || viewMode === "both") {
    channelSeries.push(
      { label: "AF7 (filtered)", color: "#2dd4bf", values: filteredAf7, width: 2 },
      { label: "AF8 (filtered)", color: "#f97066", values: filteredAf8, width: 2 },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-dim)]">View</span>
            {(["raw", "filtered", "both"] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`rounded px-2 py-1 text-xs font-medium ${viewMode === m ? "bg-[var(--accent-strong)] text-[#062824]" : "bg-[var(--bg-panel-raised)] text-[var(--text)]"}`}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-dim)]">Window</span>
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setWindowS(w)}
                className={`rounded px-2 py-1 text-xs font-medium ${windowS === w ? "bg-[var(--accent-strong)] text-[#062824]" : "bg-[var(--bg-panel-raised)] text-[var(--text)]"}`}
              >
                {w}s
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
            <input type="checkbox" checked={showCombined} onChange={(e) => setShowCombined(e.target.checked)} />
            Show frontal_mean / frontal_difference
          </label>
        </div>
      </Card>

      <Card title="AF7 / AF8 / TP9 / TP10">
        {results.length > 0 ? (
          <ScrollingLineChart timestamps={timestamps} series={channelSeries} height={260} yLabel="µV" />
        ) : (
          <EmptyState />
        )}
      </Card>

      {showCombined && (
        <Card title="Combined frontal signal">
          {results.length > 0 ? (
            <ScrollingLineChart
              timestamps={timestamps}
              series={[
                { label: "frontal_mean = (AF7+AF8)/2", color: "#c084fc", values: frontalMean, width: 2 },
                { label: "frontal_difference = AF7-AF8", color: "#5b6478", values: frontalDiff, width: 1, dash: [4, 3] },
              ]}
              height={180}
              yLabel="µV"
            />
          ) : (
            <EmptyState />
          )}
        </Card>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-[var(--text-dim)]">
      No data yet — connect a Muse 2 or start Simulation Mode.
    </div>
  );
}
