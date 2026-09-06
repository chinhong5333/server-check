// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FAST_REFRESH_INTERVAL_MS, useApiResource } from "../../src/client/hooks/useApiResource";

function ResourceProbe({ load }: { load: () => Promise<string> }) {
  const resource = useApiResource("probe", load, {
    refreshIntervalMs: FAST_REFRESH_INTERVAL_MS
  });
  return <p>{resource.status === "loading" ? "Loading" : resource.data}</p>;
}

describe("useApiResource fast refresh", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("refreshes after five seconds without replacing visible data with a loader", async () => {
    vi.useFakeTimers();
    let finishRefresh: ((value: string) => void) | undefined;
    const load = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("Initial data")
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishRefresh = resolve;
      }));

    render(<ResourceProbe load={load} />);
    await act(async () => Promise.resolve());
    expect(screen.getByText("Initial data")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(FAST_REFRESH_INTERVAL_MS));
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Initial data")).toBeInTheDocument();
    expect(screen.queryByText("Loading")).not.toBeInTheDocument();

    await act(async () => finishRefresh?.("Refreshed data"));
    expect(screen.getByText("Refreshed data")).toBeInTheDocument();
  });
});
