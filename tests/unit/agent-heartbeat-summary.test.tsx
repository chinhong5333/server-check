// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentHeartbeatSummary } from "../../src/client/components/AgentHeartbeatSummary";
const now = Date.UTC(2026, 8, 6, 8, 0, 0);
const agent = { status: "healthy" as const, probable_cause: null, last_heartbeat_at: now - 20 * 60000,
  heartbeat_interval_seconds: 3600, agent_version: "1.3.0" };
describe("Merged heartbeat summary", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it("explains the ten-minute missing-heartbeat timeout without promising a Telegram send time", () => {
    render(<AgentHeartbeatSummary agent={{ ...agent, last_heartbeat_at: now - 60000, heartbeat_interval_seconds: 600 }} help={null} />);
    expect(screen.getByText("Last Heartbeat Received")).toBeInTheDocument();
    expect(screen.getByText("Alert If No Heartbeat For")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("00 Hr 09 Min 00 Sec");
    expect(screen.queryByText(/If no heartbeat is received for/)).not.toBeInTheDocument();
    expect(screen.queryByText(/This timeout applies only/)).not.toBeInTheDocument();
  });
  it("explains why a 20-minute-old report is healthy under a one-hour interval", () => {
    render(<AgentHeartbeatSummary agent={agent} help={null} />);
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("Receiving Heartbeats")).toBeInTheDocument();
    expect(screen.getByText("20 Minutes Ago")).toBeInTheDocument();
    expect(screen.getByText("1 Hour")).toBeInTheDocument();
    expect(screen.getByText("Time Until Marked Overdue")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("00 Hr 40 Min 00 Sec");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("timer")).toHaveTextContent("00 Hr 39 Min 59 Sec");
  });
  it("uses heartbeat freshness even if newer metrics exist", () => {
    const stale = { ...agent, heartbeat_interval_seconds: 120, last_metrics_at: now };
    render(<AgentHeartbeatSummary agent={stale} help={null} />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
    expect(screen.getByText("Heartbeat Overdue")).toBeInTheDocument();
    expect(screen.getByText("Overdued")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("00 Hr 18 Min 00 Sec");
  });
  it("crosses the deadline without a reload and resets when a heartbeat arrives", () => {
    const timely = { ...agent, last_heartbeat_at: now - 119000, heartbeat_interval_seconds: 120 };
    const view = render(<AgentHeartbeatSummary agent={timely} help={null} />);
    expect(screen.getByRole("timer")).toHaveTextContent("00 Hr 00 Min 01 Sec");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("Heartbeat Overdue")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("00 Hr 00 Min 00 Sec");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("timer")).toHaveTextContent("00 Hr 00 Min 01 Sec");
    view.rerender(<AgentHeartbeatSummary agent={{ ...timely, last_heartbeat_at: Date.now() }} help={null} />);
    expect(screen.getByText("Receiving Heartbeats")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("00 Hr 02 Min 00 Sec");
  });
  it("does not hide a failing health check when the heartbeat is on time", () => {
    render(<AgentHeartbeatSummary agent={{ ...agent, status: "critical", probable_cause: "The middleware API did not return HTTP 200" }} help={null} />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Requires Attention")).toBeInTheDocument();
    expect(screen.getByText("The middleware API did not return HTTP 200")).toBeInTheDocument();
    expect(screen.getByText("Time Until Marked Overdue")).toBeInTheDocument();
    expect(screen.queryByText("Receiving Heartbeats")).not.toBeInTheDocument();
  });
  it("does not invent a due time before the first heartbeat", () => {
    render(<AgentHeartbeatSummary agent={{ ...agent, status: "new", last_heartbeat_at: null }} help={null} />);
    expect(screen.getByText("Awaiting Data")).toBeInTheDocument();
    expect(screen.getByText("No Heartbeat Received")).toBeInTheDocument();
    expect(screen.getByText("Waiting For First Heartbeat")).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });
});
