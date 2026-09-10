// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../src/client/api", () => ({ apiFetch: fetchMock }));
import { useChartInterval } from "../../src/client/hooks/useChartInterval";
beforeEach(() => { fetchMock.mockReset(); });
afterEach(cleanup);
const now = Date.now();
const points = [{ at: now - 1000 }];
it("defaults each chart to 30 minutes without extra requests and keeps selections independent", async () => {
  fetchMock.mockResolvedValue({ points: [{ at: now - 2000 }] });
  const a = renderHook(() => useChartInterval("agent-1", points));
  const b = renderHook(() => useChartInterval("agent-1", points));
  expect(a.result.current.interval).toBe(1800);
  expect(fetchMock).not.toHaveBeenCalled();
  act(() => a.result.current.setInterval(60));
  await waitFor(() => expect(a.result.current.points).toEqual([{ at: now - 2000 }]));
  const url = new URL(fetchMock.mock.calls[0][0], "https://example.test");
  expect(url.searchParams.get("bucket_seconds")).toBe("60");
  expect(Number(url.searchParams.get("to")) - Number(url.searchParams.get("from"))).toBe(7 * 86400000);
  expect(b.result.current.interval).toBe(1800);
  expect(b.result.current.points).toEqual(points);
  act(() => a.result.current.setInterval(1800));
  expect(a.result.current.points).toEqual(points);
});
it("rejects unsupported intervals and ignores late responses after switching", async () => {
  let complete!: (response: unknown) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }))
    .mockResolvedValue({ points: [{ at: now - 3000 }] });
  const view = renderHook(() => useChartInterval("agent-1", points));
  act(() => view.result.current.setInterval(42));
  expect(fetchMock).not.toHaveBeenCalled();
  act(() => view.result.current.setInterval(300));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const signal = fetchMock.mock.calls[0][1].signal;
  act(() => view.result.current.setInterval(3600));
  await waitFor(() => expect(view.result.current.points).toEqual([{ at: now - 3000 }]));
  await act(async () => { complete({ points: [{ at: now - 99000 }] }); });
  expect(signal.aborted).toBe(true);
  expect(view.result.current.points).toEqual([{ at: now - 3000 }] );
});
it("handles failed loads, retries, empty results, and cancellation", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Network error")).mockResolvedValue({ points: [] });
  const view = renderHook(() => useChartInterval("agent-1", points));
  act(() => view.result.current.setInterval(300));
  await waitFor(() => expect(view.result.current.error).not.toBeNull());
  act(() => view.result.current.retry());
  await waitFor(() => expect(view.result.current.points).toEqual([]));
  expect(view.result.current.error).toBeNull();
  const signal = fetchMock.mock.calls.at(-1)[1].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});
