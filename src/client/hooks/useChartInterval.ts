import { useEffect, useState } from "react";
import { apiFetch } from "../api";

export const CHART_INTERVALS = [
  { seconds: 60, label: "1 Min" },
  { seconds: 300, label: "5 Min" },
  { seconds: 1800, label: "30 Min" },
  { seconds: 3600, label: "1 Hour" }
] as const;

/** Keeps each chart's grouping independent; default grouping reuses the page's existing request. */
export function useChartInterval<T>(agentId: string, defaultPoints: T[]) {
  const [interval, setInterval] = useState(1800);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ interval: number; agentId: string; points: T[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setResult(null); setError(null);
    if (interval === 1800) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const to = Date.now();
        const from = to - 7 * 24 * 60 * 60 * 1000;
        const response = await apiFetch<{ points: T[] }>(
          `/api/v1/agents/${encodeURIComponent(agentId)}/history?from=${from}&to=${to}&bucket_seconds=${interval}`,
          { signal: controller.signal }
        );
        if (!controller.signal.aborted) {
          setResult({ interval, agentId, points: response.points }); setError(null);
        }
      } catch {
        if (!controller.signal.aborted) setError("Could not load this chart. Try again.");
      } finally {
        // Dense seven-day series refresh once per minute, without overlapping requests.
        if (!controller.signal.aborted) timer = setTimeout(() => void load(), 60_000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [agentId, interval, attempt]);
  const points = interval === 1800 ? defaultPoints
    : result?.interval === interval && result.agentId === agentId ? result.points : null;
  return { interval, setInterval: (value: number) => {
    if (CHART_INTERVALS.some(option => option.seconds === value)) { setError(null); setInterval(value); }
  }, points, error, retry: () => setAttempt(value => value + 1) };
}
