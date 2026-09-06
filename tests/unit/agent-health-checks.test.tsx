// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentHealthChecks, checkPresentation } from "../../src/client/components/AgentHealthChecks";
import type { AgentHealthSnapshot } from "../../src/shared/contracts";
afterEach(cleanup);
const snapshot: AgentHealthSnapshot = {
  apache: { service_name: "apache2", status: "active" }, nginx: { service_name: "nginx", status: "inactive" },
  middleware_api: { checked_at: Date.now(), outcome: "healthy", http_status_code: 200, latency_ms: 18, error_code: null, error_message: null }
};
describe("Agent service health", () => {
  it("shows independent Apache, Nginx, and API results", () => {
    render(<AgentHealthChecks checks={{ apache: true, nginx: true, middleware_api: true }} snapshot={snapshot}
      lastMetricsAt={Date.now()} lastHeartbeatAt={Date.now()} intervalSeconds={120} telemetryStale={false} />);
    expect(within(screen.getByLabelText("Apache Web Server")).getByText("Healthy")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Nginx Web Server")).getByText("Error")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Middleware API")).getByText("HTTP 200 · 18 ms")).toBeInTheDocument();
  });
  it("does not present old success as current health and distinguishes disabled checks", () => {
    render(<AgentHealthChecks checks={{ apache: true, nginx: false, middleware_api: true }} snapshot={snapshot}
      lastMetricsAt={Date.now() - 180000} lastHeartbeatAt={Date.now()} intervalSeconds={120} telemetryStale={false} />);
    expect(screen.getAllByText("Stale")).toHaveLength(2);
    expect(within(screen.getByLabelText("Nginx Web Server")).getByText("Not Monitored")).toBeInTheDocument();
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
  });
  it("keeps unknown, missing, and disabled states distinct", () => {
    expect(checkPresentation(true, "unknown", false).label).toBe("Unknown");
    expect(checkPresentation(true, undefined, false).label).toBe("Awaiting Data");
    expect(checkPresentation(false, undefined, false).label).toBe("Not Monitored");
  });
});
