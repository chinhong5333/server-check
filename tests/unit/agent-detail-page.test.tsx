// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn()
}));

vi.mock("../../src/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/api")>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { AgentDetailPage } from "../../src/client/pages/AgentDetailPage";
import { formatDateTime } from "../../src/client/lib/format";

describe("agent detail incident history", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation((path: string) => {
      if (path.endsWith("/telegram-deliveries")) {
        return Promise.resolve([
          {
            id: "delivery-1",
            event_type: "opened",
            incident_type: "heartbeat_missed",
            probable_cause: "Heartbeat overdue",
            status: "sent",
            attempt_count: 1,
            queued_at: 1_788_252_000_000,
            next_attempt_at: 1_788_252_000_000,
            sent_at: 1_788_252_001_000,
            last_error: null
          }
        ]);
      }
      if (path.endsWith("/incidents")) {
        return Promise.resolve([
          {
            id: "incident-1",
            agent_id: "agent-1",
            server_name: "atlas-web-01",
            incident_type: "heartbeat_missed",
            status: "resolved",
            severity: "critical",
            opened_at: 1_788_252_000_000,
            resolved_at: 1_788_252_120_000,
            probable_cause: "Heartbeat overdue",
            details: {
              last_heartbeat_at: 1_788_251_880_000,
              due_at: 1_788_252_000_000
            },
            last_notification_at: 1_788_252_001_000,
            created_at: 1_788_252_000_000,
            updated_at: 1_788_252_120_000
          }
        ]);
      }
      return Promise.resolve({
        agent: {
          id: "agent-1",
          project_id: "project-1",
          server_name: "atlas-web-01",
          health_api_url: "https://atlas.example.com/health",
          status: "critical",
          probable_cause: "Heartbeat overdue",
          last_heartbeat_at: 1_788_252_764_000,
          last_metrics_at: 1_788_252_700_000,
          agent_version: "1.2.0",
          heartbeat_interval_seconds: 120
        },
        from: 1_788_000_000_000,
        to: 1_788_604_800_000,
        bucket_seconds: 1800,
        points: []
      });
    });
  });

  afterEach(cleanup);

  it("shows incidents on the agent page even when metric history is empty", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/project-1/agents/agent-1"]}>
        <Routes>
          <Route path="/projects/:projectId/agents/:agentId" element={<AgentDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { level: 1, name: "atlas-web-01" })).toBeInTheDocument();
    expect(screen.getByText("Agent Detail")).toBeInTheDocument();
    expect(screen.queryByText("Agent history")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/projects/project-1"
    );
    const statusSummary = screen.getByLabelText("Agent Status Summary");
    expect(within(statusSummary).getByText("Critical")).toBeInTheDocument();
    expect(within(statusSummary).getByText("Heartbeat Overdue")).toBeInTheDocument();
    expect(within(statusSummary).getByText("Overdued")).toBeInTheDocument();
    expect(within(statusSummary).getByText("Last Heartbeat")).toBeInTheDocument();
    expect(within(statusSummary).getByText("Expected Every")).toBeInTheDocument();
    expect(within(statusSummary).queryByText("Heartbeat Interval")).not.toBeInTheDocument();
    const exactLastUpdated = statusSummary.querySelector("time");
    expect(exactLastUpdated).toHaveAttribute("dateTime", new Date(1_788_252_764_000).toISOString());
    expect(exactLastUpdated).toHaveTextContent(formatDateTime(1_788_252_764_000));
    expect(within(statusSummary).queryByText("Last Updated")).not.toBeInTheDocument();
    expect(within(statusSummary).queryByText("Last Metrics")).not.toBeInTheDocument();
    expect(within(statusSummary).getByText("2 Minutes")).toBeInTheDocument();
    expect(within(statusSummary).getByText("1.2.0")).toBeInTheDocument();
    const scriptConfiguration = screen.getByRole("heading", {
      level: 2,
      name: "Latest Script Configuration"
    }).closest("section");
    expect(scriptConfiguration).toHaveTextContent("Middleware API URL");
    expect(scriptConfiguration).toHaveTextContent("https://atlas.example.com/health");
    const stateHelpTrigger = within(statusSummary).getByRole("button", {
      name: "View Server State Definitions"
    });
    fireEvent.click(stateHelpTrigger);
    const stateHelpDialog = screen.getByRole("dialog", { name: "Server State Definitions" });
    expect(within(stateHelpDialog).getByText("Awaiting Data")).toBeInTheDocument();
    expect(within(stateHelpDialog).getByText("Healthy")).toBeInTheDocument();
    expect(within(stateHelpDialog).getByText("Warning")).toBeInTheDocument();
    expect(within(stateHelpDialog).getByText("Critical")).toBeInTheDocument();
    expect(within(stateHelpDialog).getByText("Stale")).toBeInTheDocument();
    expect(within(stateHelpDialog).getByText(/RAM, storage, or CPU load/)).toBeInTheDocument();
    const cancelEvent = new Event("cancel", { bubbles: true, cancelable: true });
    fireEvent(stateHelpDialog, cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
    fireEvent.click(stateHelpDialog);
    expect(screen.getByRole("dialog", { name: "Server State Definitions" })).toBeInTheDocument();
    fireEvent.click(within(stateHelpDialog).getByRole("button", { name: "Close Server State Definitions" }));
    await waitFor(() => expect(stateHelpTrigger).toHaveFocus());
    expect(screen.getByText("No Metric History Yet")).toBeInTheDocument();
    const incidentTab = screen.getByRole("tab", { name: /Incident History/ });
    const telegramTab = screen.getByRole("tab", { name: /Telegram Delivery Log/ });
    expect(incidentTab).toHaveAttribute("aria-selected", "true");
    expect(telegramTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("heading", { level: 2, name: "Incident History" })).toBeInTheDocument();
    expect(screen.getByText("Conditions recorded for this agent, with the newest occurrence first.")).toBeInTheDocument();
    const incidentHistory = screen.getByRole("region", { name: "Incident History" });
    expect(within(incidentHistory).getByRole("columnheader", { name: "Incident" })).toBeInTheDocument();
    expect(within(incidentHistory).getByRole("columnheader", { name: "Details" })).toBeInTheDocument();
    expect(within(incidentHistory).getByRole("columnheader", { name: "Occurred At" })).toBeInTheDocument();
    expect(within(incidentHistory).queryByRole("columnheader", { name: "State" })).not.toBeInTheDocument();
    expect(within(incidentHistory).queryByRole("columnheader", { name: "Recovered" })).not.toBeInTheDocument();
    expect(within(incidentHistory).getByText("01 Sep 2026")).toBeInTheDocument();
    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
    expect(screen.queryByText("Still open")).not.toBeInTheDocument();
    expect(within(incidentHistory).getByText("Heartbeat overdue")).toBeInTheDocument();
    expect(within(incidentHistory).getByText("Heartbeat Missed")).toBeInTheDocument();
    const rawLogButton = within(incidentHistory).getByRole("button", { name: "View Raw Log" });
    fireEvent.click(rawLogButton);
    const rawLogDialog = screen.getByRole("dialog", { name: "Incident Raw Log" });
    expect(within(rawLogDialog).getByText(/complete normalized record for heartbeat missed/i)).toBeInTheDocument();
    expect(within(rawLogDialog).getByRole("button", { name: "Copy Raw Log" })).toBeInTheDocument();
    expect(rawLogDialog.querySelector("code")?.textContent).toContain('"due_at": 1788252000000');
    expect(rawLogDialog.querySelector("code")?.textContent).toContain('"severity": "critical"');
    fireEvent.click(within(rawLogDialog).getByRole("button", { name: "Close Incident Raw Log" }));
    await waitFor(() => expect(rawLogButton).toHaveFocus());
    expect(screen.queryByRole("region", { name: "Telegram Delivery Log" })).not.toBeInTheDocument();
    fireEvent.keyDown(incidentTab, { key: "ArrowRight" });
    await waitFor(() => expect(telegramTab).toHaveFocus());
    expect(telegramTab).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("region", { name: "Incident History" })).not.toBeInTheDocument();
    const telegramLog = screen.getByRole("region", { name: "Telegram Delivery Log" });
    expect(within(telegramLog).getByRole("columnheader", { name: "Delivery" })).toBeInTheDocument();
    expect(within(telegramLog).getByText("Sent")).toBeInTheDocument();
    expect(within(telegramLog).getByText("Delivered")).toBeInTheDocument();
    expect(within(telegramLog).getAllByText("01 Sep 2026").length).toBeGreaterThanOrEqual(2);
  });

  it("presents resource history as utilization and CPU load", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.endsWith("/telegram-deliveries")) return Promise.resolve([]);
      if (path.endsWith("/incidents")) return Promise.resolve([]);
      return Promise.resolve({
        agent: {
          id: "agent-1",
          project_id: "project-1",
          server_name: "atlas-web-01",
          health_api_url: "https://atlas.example.com/health",
          status: "healthy",
          probable_cause: null,
          last_heartbeat_at: 1_788_252_764_000,
          last_metrics_at: 1_788_252_764_000,
          agent_version: "1.2.0",
          heartbeat_interval_seconds: 120
        },
        from: 1_788_000_000_000,
        to: 1_788_604_800_000,
        bucket_seconds: 1800,
        points: [
          {
            at: 1_788_252_764_000,
            ram_available_percent: 25,
            disk_available_percent: 40,
            load_5_per_core: 0.5,
            health_latency_ms: 42,
            health_success_percent: 100
          }
        ]
      });
    });

    render(
      <MemoryRouter initialEntries={["/projects/project-1/agents/agent-1"]}>
        <Routes>
          <Route path="/projects/:projectId/agents/:agentId" element={<AgentDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { level: 2, name: "RAM Utilization" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Storage Utilization" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "CPU Load" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "RAM Utilization" }).closest("section")?.querySelector(".chart-latest")
    ).toHaveTextContent("Latest Value75.0%");
    expect(
      screen.getByRole("heading", { level: 2, name: "Storage Utilization" }).closest("section")?.querySelector(".chart-latest")
    ).toHaveTextContent("Latest Value60.0%");
    expect(
      screen.getByRole("heading", { level: 2, name: "CPU Load" }).closest("section")?.querySelector(".chart-latest")
    ).toHaveTextContent("Latest Value0.5x");
    expect(
      screen.getByRole("heading", { level: 2, name: "Health Latency" }).closest("section")?.querySelector(".chart-latest")
    ).toHaveTextContent("Latest Value42 ms");
    expect(screen.queryByRole("heading", { name: "RAM available" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Storage available" })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("Agent Status Summary")).queryByText("No active condition")).not.toBeInTheDocument();
  });
});
