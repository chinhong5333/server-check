// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FAST_REFRESH_INTERVAL_MS, useApiResource } from "../../src/client/hooks/useApiResource";

function ResourceProbe({ load }: { load: () => Promise<string> }) {
  const resource = useApiResource("probe", load, {
    refreshIntervalMs: FAST_REFRESH_INTERVAL_MS
  });
  return <><p>{resource.status === "loading" ? "Loading" : resource.data}</p><output>{resource.refreshFailures} {resource.fetchedAt ?? "never"}</output></>;
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

  it("refreshes as soon as a hidden page returns, once per return", async () => {
    vi.useFakeTimers();
    let visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility as DocumentVisibilityState);
    const load = vi.fn<() => Promise<string>>().mockResolvedValue("Data");
    render(<ResourceProbe load={load} />);
    await act(async () => Promise.resolve());
    expect(load).toHaveBeenCalledTimes(1);

    visibility = "hidden";
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    expect(load).toHaveBeenCalledTimes(1);

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(load).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("keeps the last data and counts failed refreshes until one succeeds", async () => {
    vi.useFakeTimers({ now: 1_000 });
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce("Last data")
      .mockRejectedValueOnce(new Error("Offline")).mockRejectedValueOnce(new Error("Offline")).mockResolvedValue("New data");
    render(<ResourceProbe load={load} />);
    await act(async () => Promise.resolve());
    expect(screen.getByRole("status")).toHaveTextContent("0 1000");

    await act(async () => { await vi.advanceTimersByTimeAsync(FAST_REFRESH_INTERVAL_MS); });
    await act(async () => { await vi.advanceTimersByTimeAsync(FAST_REFRESH_INTERVAL_MS); });
    expect(screen.getByText("Last data")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 1000");

    await act(async () => { await vi.advanceTimersByTimeAsync(FAST_REFRESH_INTERVAL_MS); });
    expect(screen.getByText("New data")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 16000");
  });
});
