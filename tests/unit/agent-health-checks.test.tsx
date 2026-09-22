// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentHealthChecks, checkPresentation } from "../../src/client/components/AgentHealthChecks";
import type { AgentHealthSnapshot } from "../../src/shared/contracts";
afterEach(cleanup);
const snapshot: AgentHealthSnapshot = {
  apache: { service_name: "apache2", status: "active" }, nginx: { service_name: "nginx", status: "inactive" },
  middleware_api: { checked_at: Date.now(), outcome: "healthy", http_status_code: 200, latency_ms: 18, error_code: null, error_message: null }
};
const databaseHealth = { status: "alive", message: "", connection_count: 58, connection_max: 150,
  threads_running: 1, peak_connections: 67, long_queries: 0, db_size_mb: 8329.7 };
describe("Agent service health", () => {
  it("shows independent Apache, Nginx, and API results", () => {
    render(<AgentHealthChecks checks={{ apache: true, nginx: true, middleware_api: true }} snapshot={snapshot}
      databaseHealth={databaseHealth}
      lastMetricsAt={Date.now()} lastHeartbeatAt={Date.now()} intervalSeconds={120} telemetryStale={false} />);
    expect(within(screen.getByLabelText("Apache Web Server")).getByText("Healthy")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Nginx Web Server")).getByText("Error")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Middleware API")).getByText("HTTP 200 · 18 ms")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Database Health" })).toBeInTheDocument();
    expect(screen.getByText("8.13 GiB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Raw DB Response" })).toBeInTheDocument();
  });
  it("opens the exact raw database response in a copyable modal", () => {
    render(<AgentHealthChecks checks={{ apache: true, nginx: true, middleware_api: true }} snapshot={snapshot}
      databaseHealth={{ ...databaseHealth, raw: { status: "alive", fragmented_mb: "46.0" } }}
      lastMetricsAt={Date.now()} lastHeartbeatAt={Date.now()} intervalSeconds={120} telemetryStale={false} />);
    fireEvent.click(screen.getByRole("button", { name: "View Raw DB Response" }));
    const dialog = screen.getByRole("dialog", { name: "Raw DB Response" });
    expect(within(dialog).getByText(/"fragmented_mb": "46.0"/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Copy Raw DB Response" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close Raw DB Response" }));
    expect(screen.queryByRole("dialog", { name: "Raw DB Response" })).not.toBeInTheDocument();
  });
  it("shows empty database previews without presenting old service success as current", () => {
    render(<AgentHealthChecks checks={{ apache: true, nginx: false, middleware_api: true }} snapshot={snapshot}
      lastMetricsAt={Date.now() - 180000} lastHeartbeatAt={Date.now()} intervalSeconds={120} telemetryStale={false} />);
    expect(screen.getAllByText("Stale")).toHaveLength(2);
    expect(within(screen.getByLabelText("Nginx Web Server")).getByText("Not Monitored")).toBeInTheDocument();
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Database Health" })).toBeInTheDocument();
    expect(screen.getByText("No Database Data")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View Raw DB Response" }));
    const dialog = screen.getByRole("dialog", { name: "Raw DB Response" });
    expect(within(dialog).getByText("No Raw DB Response")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Copy Raw DB Response" })).not.toBeInTheDocument();
  });
  it("shows database monitoring as disabled instead of hiding the section", () => {
    render(<AgentHealthChecks checks={{ apache: true, nginx: false, middleware_api: false }} snapshot={snapshot}
      lastMetricsAt={Date.now()} lastHeartbeatAt={Date.now()} intervalSeconds={120} telemetryStale={false} />);
    expect(screen.getByRole("heading", { name: "Database Health" })).toBeInTheDocument();
    expect(screen.getByText("Database Not Monitored")).toBeInTheDocument();
    expect(screen.getByText("Not Monitored", { selector: ".agent-database-health .status" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View Raw DB Response" }));
    expect(screen.getByText("Middleware API monitoring is disabled in the latest generated agent script.")).toBeInTheDocument();
  });
  it("shows a graceful database error without rendering stale capacity values", () => {
    render(<AgentHealthChecks checks={{ apache: true, nginx: true, middleware_api: true }} snapshot={snapshot}
      databaseHealth={{ ...databaseHealth, status: "unavailable", message: "Connection timed out." }}
      lastMetricsAt={Date.now()} lastHeartbeatAt={Date.now()} intervalSeconds={120} telemetryStale={false} />);
    expect(screen.getByText("Database Check Failed")).toBeInTheDocument();
    expect(screen.getByText("Connection timed out.")).toBeInTheDocument();
    expect(screen.queryByText("Current Connections")).not.toBeInTheDocument();
  });
  it("labels database values as last reported when telemetry is stale", () => {
    render(<AgentHealthChecks checks={{ apache: true, nginx: true, middleware_api: true }} snapshot={snapshot}
      databaseHealth={databaseHealth} lastMetricsAt={Date.now()} lastHeartbeatAt={Date.now()}
      intervalSeconds={120} telemetryStale />);
    expect(screen.getByText("Last Reported Connections")).toBeInTheDocument();
    expect(screen.getAllByText("Last Reported")).toHaveLength(3);
    expect(screen.queryByText("Active Now")).not.toBeInTheDocument();
  });
  it("keeps unknown, missing, and disabled states distinct", () => {
    expect(checkPresentation(true, "unknown", false).label).toBe("Unknown");
    expect(checkPresentation(true, undefined, false).label).toBe("Awaiting Data");
    expect(checkPresentation(false, undefined, false).label).toBe("Not Monitored");
  });
});
