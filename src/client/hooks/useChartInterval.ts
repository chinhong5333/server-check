import { useEffect, useState } from "react";
import { apiFetch } from "../api";
export const CHART_INTERVALS = [
  { seconds: 60, label: "1 Min" }, { seconds: 300, label: "5 Min" },
  { seconds: 1800, label: "30 Min" }, { seconds: 3600, label: "1 Hour" }
] as const;

/** Native Canvas panning uses loaded history, never a fetch on pointer release. */
export function useChartInterval<T extends { at: number }>(agentId: string, defaultPoints: T[]) {
  const [interval, setInterval] = useState(1800);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; points: T[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${agentId}:${interval}`;
  useEffect(() => {
    setError(null);
    if (interval === 1800) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const to = Date.now();
        const from = to - 7 * 86400000;
        const response = await apiFetch<{ points: T[] }>(
          `/api/v1/agents/${encodeURIComponent(agentId)}/history?from=${from}&to=${to}&bucket_seconds=${interval}`,
          { signal: controller.signal }
        );
        if (!controller.signal.aborted) { setResult({ key, points: response.points }); setError(null); }
      } catch {
        if (!controller.signal.aborted) setError("Could not load this chart. Try again.");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void load(), 60_000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [key, attempt, interval, agentId]);
  return { interval, points: interval === 1800 ? defaultPoints : result?.key === key ? result.points : null, error,
    setInterval: (value: number) => {
      if (CHART_INTERVALS.some(option => option.seconds === value)) { setError(null); setInterval(value); }
    },
    retry: () => setAttempt(value => value + 1)
  };
}
