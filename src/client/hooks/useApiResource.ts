import { useCallback, useEffect, useState } from "react";

interface ResourceState<T> {
  data: T | null;
  status: "loading" | "success" | "error";
  error: Error | null;
  /** When data last loaded successfully. */
  fetchedAt: number | null;
  /** Consecutive background refresh failures; data stays visible as the last received copy. */
  refreshFailures: number;
  reload: () => void;
}

interface ResourceOptions {
  refreshIntervalMs?: number;
}

export const FAST_REFRESH_INTERVAL_MS = 5_000;

export function useApiResource<T>(
  key: string,
  load: () => Promise<T>,
  { refreshIntervalMs = 0 }: ResourceOptions = {}
): ResourceState<T> {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<Omit<ResourceState<T>, "reload">>({
    data: null,
    status: "loading",
    error: null,
    fetchedAt: null,
    refreshFailures: 0
  });

  useEffect(() => {
    let current = true;
    let refreshTimer: number | undefined;
    let inFlight = false;
    let requestedAt = 0;

    const scheduleRefresh = () => {
      if (!current || refreshIntervalMs <= 0) return;
      refreshTimer = window.setTimeout(() => {
        if (document.visibilityState === "hidden") {
          scheduleRefresh();
          return;
        }
        void request(true);
      }, refreshIntervalMs);
    };

    async function request(background: boolean) {
      if (!background) setState({ data: null, status: "loading", error: null, fetchedAt: null, refreshFailures: 0 });
      inFlight = true;
      requestedAt = Date.now();

      try {
        const data = await load();
        if (current) setState({ data, status: "success", error: null, fetchedAt: Date.now(), refreshFailures: 0 });
      } catch (cause) {
        if (current) {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          setState((previous) =>
            background && previous.data !== null
              ? { ...previous, error, refreshFailures: previous.refreshFailures + 1 }
              : { data: null, status: "error", error, fetchedAt: null, refreshFailures: 0 }
          );
        }
      } finally {
        inFlight = false;
        scheduleRefresh();
      }
    }

    // Polling pauses while hidden, so catch up as soon as the page is back instead of waiting for the next timer.
    const refreshOnReturn = () => {
      if (refreshIntervalMs <= 0 || inFlight || document.visibilityState === "hidden") return;
      if (Date.now() - requestedAt < refreshIntervalMs) return;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      void request(true);
    };
    document.addEventListener("visibilitychange", refreshOnReturn);
    window.addEventListener("focus", refreshOnReturn);

    void request(false);
    return () => {
      current = false;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", refreshOnReturn);
      window.removeEventListener("focus", refreshOnReturn);
    };
  }, [key, version, load, refreshIntervalMs]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { ...state, reload };
}
