import { useEffect, useRef } from "react";
import uPlot from "uplot";

export interface ChartSeries {
  label: string;
  color: string;
  values: Float64Array | number[];
  width?: number;
  dash?: number[];
}

/**
 * A performant scrolling multi-series line chart (project brief section
 * 34: canvas-based, not one React re-render per EEG sample). Re-renders
 * its data via uPlot's setData on prop changes but never recreates the
 * uPlot instance unless the series count changes, keeping this cheap
 * enough to call every worker result batch (~30Hz).
 */
export function ScrollingLineChart({
  timestamps,
  series,
  height = 180,
  yLabel,
}: {
  timestamps: Float64Array | number[];
  series: ChartSeries[];
  height?: number;
  yLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const seriesCountRef = useRef<number>(-1);

  useEffect(() => {
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const data: uPlot.AlignedData = [timestamps as number[], ...series.map((s) => s.values as number[])];

    if (!plotRef.current || seriesCountRef.current !== series.length) {
      plotRef.current?.destroy();
      seriesCountRef.current = series.length;
      const opts: uPlot.Options = {
        width: containerRef.current.clientWidth || 600,
        height,
        padding: [8, 8, 8, 8],
        cursor: { drag: { x: false, y: false } },
        legend: { show: true },
        axes: [
          { stroke: "#7d8598", grid: { stroke: "#262b38" }, values: (_u, vals) => vals.map((v) => `${v.toFixed(1)}s`) },
          { stroke: "#7d8598", grid: { stroke: "#262b38" }, label: yLabel },
        ],
        series: [
          {},
          ...series.map((s) => ({
            label: s.label,
            stroke: s.color,
            width: s.width ?? 1.5,
            dash: s.dash,
            points: { show: false },
          })),
        ],
      };
      plotRef.current = new uPlot(opts, data, containerRef.current);
    } else {
      plotRef.current.setData(data);
    }
  }, [timestamps, series, height, yLabel]);

  useEffect(() => {
    const handleResize = () => {
      if (plotRef.current && containerRef.current) {
        plotRef.current.setSize({ width: containerRef.current.clientWidth, height });
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [height]);

  return <div ref={containerRef} className="w-full" />;
}
