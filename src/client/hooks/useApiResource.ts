import { useCallback, useEffect, useState } from "react";

interface ResourceState<T> {
  data: T | null;
  status: "loading" | "success" | "error";
  error: Error | null;
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
    error: null
  });

  useEffect(() => {
    let current = true;
    let refreshTimer: number | undefined;

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
      if (background) {
        setState((previous) => ({ ...previous, error: null }));
      } else {
        setState({ data: null, status: "loading", error: null });
      }

      try {
        const data = await load();
        if (current) setState({ data, status: "success", error: null });
      } catch (cause) {
        if (current) {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          setState((previous) =>
            background && previous.data !== null
              ? { ...previous, error }
              : { data: null, status: "error", error }
          );
        }
      } finally {
        scheduleRefresh();
      }
    }

    void request(false);
    return () => {
      current = false;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [key, version, load, refreshIntervalMs]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { ...state, reload };
}
