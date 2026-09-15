import { useMemo } from "react";
import { useAppStore } from "../state/appStore";
import type { PipelineStepResult, Sample } from "../core/types";

/** Slices the store's ring buffers to the last `windowS` seconds, relative
 * to the newest sample's own timestamp (not wall-clock time, so this works
 * identically for live and simulated/replayed data). Results and raw
 * samples are always the same length and share indices (pushed together
 * by appStore.pushResults). */
export function useWindowedResults(windowS: number): { results: PipelineStepResult[]; rawSamples: Sample[] } {
  const recentResults = useAppStore((s) => s.recentResults);
  const recentRawSamples = useAppStore((s) => s.recentRawSamples);
  return useMemo(() => {
    if (recentResults.length === 0) return { results: [], rawSamples: [] };
    const latestT = recentResults[recentResults.length - 1].timestampS;
    const cutoff = latestT - windowS;
    let startIdx = recentResults.length - 1;
    while (startIdx > 0 && recentResults[startIdx - 1].timestampS >= cutoff) startIdx--;
    return { results: recentResults.slice(startIdx), rawSamples: recentRawSamples.slice(startIdx) };
  }, [recentResults, recentRawSamples, windowS]);
}
