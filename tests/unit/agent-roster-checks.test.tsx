// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "../../src/shared/contracts";
import { AgentRosterChecks } from "../../src/client/components/AgentRosterChecks";
import { AgentActionsMenu } from "../../src/client/components/AgentActionsMenu";

const now = 1_791_434_800_000;
const agent = {
  server_name: "api-01", status: "healthy", last_metrics_at: now, last_heartbeat_at: now,
  heartbeat_interval_seconds: 120, checks: { apache: true, nginx: true, middleware_api: true },
  health_outcome: "healthy", database_status: "alive",
  service_health: { apache: { service_name: "apache2", status: "active" },
    nginx: { service_name: "nginx", status: "inactive" } }
} as AgentSummary;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("compact agent roster states", () => {
  it("shows labelled healthy and failing checks without hiding failures during maintenance", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    render(<AgentRosterChecks agent={{ ...agent, maintenance: { status: "active", scope: "project" }, database_status: "dead" }} />);
    const list = screen.getByRole("table", { name: "Health Checks For api-01" });
    expect(within(list).getAllByText("Healthy")).toHaveLength(2);
    expect(within(list).getAllByText("Error")).toHaveLength(2);
    expect(within(list).getAllByRole("rowheader").map(row => row.textContent)).toEqual(["Apache", "Nginx", "API", "Database"]);
    expect(within(list).getByRole("rowheader", { name: "Middleware API" })).toHaveTextContent("API");
  });
  it("distinguishes missing database data, awaiting service results and disabled monitoring", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { rerender } = render(<AgentRosterChecks agent={{ ...agent, service_health: null, database_status: null }} />);
    expect(screen.getByText("Not Reported")).toBeInTheDocument();
    expect(screen.getAllByText("Awaiting Data")).toHaveLength(2);
    rerender(<AgentRosterChecks agent={{ ...agent, checks: { apache: false, nginx: false, middleware_api: false } }} />);
    expect(screen.getAllByText("Not Monitored")).toHaveLength(4);
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
  });
  it("marks old readings stale even when the agent's persisted status is healthy", () => {
    vi.spyOn(Date, "now").mockReturnValue(now + 121_000);
    render(<AgentRosterChecks agent={agent} />);
    expect(screen.getAllByText("Stale")).toHaveLength(4);
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
  });
  it("opens the action disclosure, focuses its action and restores focus on Escape", () => {
    render(<AgentActionsMenu name="api-01"><button type="button">Edit</button></AgentActionsMenu>);
    const panel = screen.getByLabelText("Actions For api-01");
    let open = false;
    Object.assign(panel, {
      showPopover: () => { open = true; panel.style.display = "block"; },
      hidePopover: () => { open = false; panel.style.display = "none"; }
    });
    vi.spyOn(panel, "matches").mockImplementation(() => open);
    const trigger = screen.getByRole("button", { name: "More Actions For api-01" });
    fireEvent.click(trigger);
    expect(open).toBe(true);
    expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(open).toBe(false);
    expect(trigger).toHaveFocus();
  });
});
