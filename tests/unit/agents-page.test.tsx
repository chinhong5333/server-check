// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary, ProjectSummary } from "../../src/shared/contracts";

const { apiFetchMock, projectFixture, authFixture } = vi.hoisted(() => ({
  authFixture: { role: "admin" },
  apiFetchMock: vi.fn(),
  projectFixture: {
    id: "project-1",
    name: "Project Atlas",
    slug: "project-atlas",
    ram_available_threshold_percent: 15,
    disk_available_threshold_percent: 10,
    load_5_per_core_threshold: 1,
    heartbeat_interval_seconds: 120,
    healthy_agents: 1,
    new_agents: 0,
    warning_agents: 0,
    critical_agents: 0,
    stale_agents: 1
  } satisfies ProjectSummary
}));

vi.mock("../../src/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/api")>();
  return { ...actual, apiFetch: apiFetchMock };
});

vi.mock("../../src/client/projects/ProjectProvider", () => ({
  useProjects: () => ({
    selectedProject: projectFixture,
    status: "success",
    error: null,
    reloadProjects: vi.fn()
  })
}));

vi.mock("../../src/client/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "operator@example.com", role: authFixture.role },
    logout: vi.fn()
  })
}));

vi.mock("../../src/client/hooks/useMediaQuery", () => ({
  useMediaQuery: () => true
}));

import { InstallAgentPage } from "../../src/client/pages/InstallAgentPage";
import { AppShell } from "../../src/client/components/AppShell";
import { ToastProvider } from "../../src/client/components/ToastProvider";

const agents: AgentSummary[] = [
  {
    id: "agent-1",
    server_name: "atlas-web-01",
    health_api_url: "https://atlas.example.com/api/health",
    status: "healthy",
    probable_cause: null,
    last_heartbeat_at: 1_788_252_764_000,
    last_metrics_at: 1_788_252_764_000,
    agent_version: "1.1.0",
    ram_available_percent: 44,
    disk_available_percent: 62,
    load_5_per_core: 0.4,
    latest_load_5: 0.76,
    health_outcome: "healthy",
    health_http_status_code: 200,
    health_latency_ms: 42,
    ram_available_threshold_percent: 15,
    disk_available_threshold_percent: 10,
    load_5_per_core_threshold: 1.5,
    heartbeat_interval_seconds: 120,
    telegram_alert_cooldown_seconds: 900
  },
  {
    id: "agent-2",
    server_name: "atlas-worker-01",
    health_api_url: "https://worker.atlas.example.com/health",
    status: "new",
    probable_cause: "Awaiting first heartbeat",
    last_heartbeat_at: null,
    last_metrics_at: null,
    agent_version: null,
    ram_available_percent: null,
    disk_available_percent: null,
    load_5_per_core: null,
    latest_load_5: null,
    health_outcome: null,
    health_http_status_code: null,
    health_latency_ms: null,
    ram_available_threshold_percent: 20,
    disk_available_threshold_percent: 12,
    load_5_per_core_threshold: 2,
    heartbeat_interval_seconds: 300,
    telegram_alert_cooldown_seconds: 1800
  }
];

const replacementInstallation = {
  agent_id: "agent-1",
  script_filename: "server-check-atlas-web-renamed.sh",
  script: "#!/bin/sh\n# protected replacement\n",
  crontab_entry: "*/2 * * * * /bin/sh '/opt/server-check/server-check-atlas-web-renamed.sh'",
  credential_shown_once: true as const
};

function renderAgentsPage(path = "/projects/project-1/agents") {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <InstallAgentPage />
      </MemoryRouter>
    </ToastProvider>
  );
}

describe("project-scoped agents page", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    authFixture.role = "admin";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("uses canonical project workspace navigation instead of a global project selector", () => {
    render(
      <MemoryRouter initialEntries={["/projects/project-1/agents"]}>
        <AppShell><p>Workspace content</p></AppShell>
      </MemoryRouter>
    );

    expect(screen.queryByRole("navigation", { name: "Global" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Projects", exact: true })).not.toBeInTheDocument();
    const projectNavigation = screen.getByRole("navigation", { name: "Project workspace for Project Atlas" });
    const settingsLink = screen.getByRole("link", { name: "Settings" });
    const currentProjectLabel = screen.getByText("Current Project");
    const overviewLink = within(projectNavigation).getByRole("link", { name: "Overview" });
    const projectSelector = screen.getByRole("link", {
      name: "Switch Project: Project Atlas"
    });

    expect(screen.getByRole("link", { name: /Server Check\s*Internal Operations/ })).toHaveAttribute("href", "/projects");
    expect(screen.queryByRole("link", { name: "All projects" })).not.toBeInTheDocument();
    expect(settingsLink).toHaveAttribute("href", "/settings");
    expect(overviewLink).toHaveAttribute(
      "href",
      "/projects/project-1"
    );
    expect(projectSelector).toHaveAttribute("href", "/projects");
    expect(projectSelector).toHaveAttribute("title", "Switch Project");
    const accountLink = screen.getByRole("link", { name: "Account Settings: operator@example.com" });
    expect(accountLink).toHaveAttribute("href", "/settings/password");
    expect(accountLink).toHaveTextContent("operator@example.com");
    expect(screen.queryByRole("link", { name: "Account Settings", exact: true })).not.toBeInTheDocument();
    expect(settingsLink).toHaveClass("icon-button");
    expect(settingsLink.parentElement).toContainElement(screen.getByRole("button", { name: /Mode: Switch To/ }));
    expect(currentProjectLabel.compareDocumentPosition(overviewLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Agents/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Incidents" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Project setting" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Project" })).not.toBeInTheDocument();
  });

  it("shows one project with its agent roster before registration", async () => {
    apiFetchMock.mockResolvedValue(agents);

    renderAgentsPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Operations Overview" })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Project summary")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename Project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Project" })).toBeInTheDocument();
    expect(screen.queryByText("Open incidents")).not.toBeInTheDocument();
    expect(screen.queryByText("RAM alert below")).not.toBeInTheDocument();
    expect(screen.getAllByText("RAM")).toHaveLength(2);
    expect(screen.getByText("56.0%")).toBeInTheDocument();
    expect(screen.getAllByText("Storage")).toHaveLength(2);
    expect(screen.getByText("38.0%")).toBeInTheDocument();
    expect(screen.getAllByText("Load Average (5 Min)")).toHaveLength(2);
    expect(screen.getByText("0.76")).toBeInTheDocument();
    expect(screen.queryByText("0.4x")).not.toBeInTheDocument();
    expect(screen.queryByText("CPU Load")).not.toBeInTheDocument();
    expect(screen.queryByText("1 project")).not.toBeInTheDocument();
    expect(screen.queryByText("many agents")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Registered Agents" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("agent-roster-table");
    expect(screen.getByRole("columnheader", { name: "Agent Name" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Server" })).not.toBeInTheDocument();
    expect(screen.getByText("Total 2 Agents")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Server State" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Resource Use" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Last Heartbeat" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Agent Name",
      "Resource Use",
      "Server State",
      "Last Heartbeat",
      "Actions",
    ]);
    expect(screen.queryByRole("columnheader", { name: "Application API" })).not.toBeInTheDocument();
    expect(screen.getByText("atlas-web-01")).toBeInTheDocument();
    expect(screen.getByText("atlas-worker-01")).toBeInTheDocument();
    expect(screen.queryByText("No active condition")).not.toBeInTheDocument();
    expect(screen.getByText("Awaiting first heartbeat")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Agent Detail For atlas-web-01" })).toHaveAttribute(
      "href",
      "/projects/project-1/agents/agent-1"
    );
    expect(screen.getByRole("button", { name: "Edit atlas-web-01" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rotate atlas-web-01 Access Secret" })).toHaveAttribute(
      "aria-haspopup",
      "dialog"
    );
    expect(screen.getByRole("button", { name: "Delete atlas-web-01" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Agent Detail For atlas-web-01" })).toHaveAttribute(
      "title",
      "View Agent Detail"
    );
    expect(screen.getByRole("button", { name: "Edit atlas-web-01" })).toHaveAttribute(
      "aria-haspopup",
      "dialog"
    );
    expect(screen.getByRole("button", { name: "Delete atlas-web-01" })).toHaveAttribute(
      "aria-haspopup",
      "dialog"
    );
    expect(screen.queryByRole("heading", { name: "Register Agent" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Register Agent" }));

    expect(screen.getByRole("dialog", { name: "Register Agent" })).toHaveClass("agent-dialog--agent-form");
    expect(screen.getByRole("heading", { name: "Register Agent" })).toBeInTheDocument();
    expect(
      screen.getByText("The new agent will belong to Project Atlas.")
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Health timeout (seconds)")).not.toBeInTheDocument();
    const serverDetailsGroup = screen.getByRole("group", { name: "Server Details" });
    const serverNameField = screen.getByLabelText("Server Name");
    expect(within(serverDetailsGroup).queryByLabelText("Middleware API URL")).not.toBeInTheDocument();
    expect(serverNameField.parentElement?.parentElement).toHaveClass("form-section__grid");
    const thresholdsGroup = screen.getByRole("group", { name: "Alert Thresholds" });
    const heartbeatGroup = screen.getByRole("group", { name: "Heartbeat" });
    expect(thresholdsGroup.parentElement).toBe(heartbeatGroup.parentElement?.parentElement);
    expect(thresholdsGroup.parentElement).toHaveClass("agent-form-policy-row");
    expect(screen.getByLabelText("RAM Usage Threshold (%)")).toHaveValue("85");
    expect(screen.getByLabelText("Storage Usage Threshold (%)")).toHaveValue("90");
    expect(screen.getByLabelText("Load Per Core Threshold")).toHaveValue("1.5");
    expect(screen.getByLabelText("Alert If No Heartbeat For")).toHaveValue("120");
    expect(screen.getByLabelText("Telegram Send Interval")).toHaveValue("900");
    expect(screen.getByText("Minimum wait after a successful Telegram message.")).toBeInTheDocument();
    expect(screen.getByText("Alerts at or above this RAM usage.")).toBeInTheDocument();
    expect(screen.getByText("Alerts at or above this storage usage.")).toBeInTheDocument();
    expect(screen.getByText("Alerts when five-minute load divided by logical CPU count reaches this value.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Server Name")).toHaveFocus());
    const registrationDialog = screen.getByRole("dialog", { name: "Register Agent" });
    const cancelEvent = new Event("cancel", { bubbles: true, cancelable: true });
    fireEvent(registrationDialog, cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
    fireEvent.click(registrationDialog);
    expect(screen.getByRole("dialog", { name: "Register Agent" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue To Script Generation" }));
    expect(
      within(screen.getByRole("region", { name: "Notifications" })).getByRole("alert")
    ).toHaveTextContent("Check the server details, utilization thresholds, heartbeat interval, and Telegram send interval.");
    fireEvent.click(screen.getByRole("button", { name: "Close Registration" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Register Agent" })).toHaveFocus());
  });

  it("warns when the last heartbeat exceeds the agent interval", async () => {
    vi.spyOn(Date, "now").mockReturnValue((agents[0].last_heartbeat_at ?? 0) + 121_000);
    apiFetchMock.mockResolvedValue([
      {
        ...agents[0],
        status: "critical",
        probable_cause: "Heartbeat overdue"
      }
    ]);

    renderAgentsPage();

    const row = await screen.findByRole("row", { name: /atlas-web-01/i });
    expect(within(row).getByText("Critical")).toBeInTheDocument();
    expect(within(row).getByText("Heartbeat overdue")).toBeInTheDocument();
    expect(within(row).getByText("Exceeds Heartbeat Interval")).toBeInTheDocument();
    expect(within(row).queryByText(/heartbeat interval · 2 mins/i)).not.toBeInTheDocument();
    expect(within(row).queryByText("HTTP 200 · 42 ms")).not.toBeInTheDocument();
  });

  it("explains the empty relationship and offers the first registration", async () => {
    apiFetchMock.mockResolvedValue([]);

    renderAgentsPage();

    expect(await screen.findByText("No Registered Agents")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register First Agent" })).toBeInTheDocument();
  });

  it("confirms agent registration with a toast", async () => {
    apiFetchMock.mockImplementation((_path, init) =>
      init?.method === "POST" ? Promise.resolve(replacementInstallation) : Promise.resolve(agents)
    );

    renderAgentsPage();

    fireEvent.click(await screen.findByRole("button", { name: "Register Agent" }));
    fireEvent.change(screen.getByLabelText("Server Name"), {
      target: { value: "atlas-api-01" }
    });
    expect(screen.queryByLabelText("Middleware API URL")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue To Script Generation" }));
    expect(screen.getByRole("dialog", { name: "Generate Agent Script" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Middleware API URL"), {
      target: { value: "https://api.atlas.example.com/health" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Script" }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/agent-installations",
        {
          method: "POST",
          body: JSON.stringify({
            server_name: "atlas-api-01",
            health_api_url: "https://api.atlas.example.com/health",
            checks: { apache: true, nginx: false, middleware_api: true },
            ram_available_threshold_percent: 15,
            disk_available_threshold_percent: 10,
            load_5_per_core_threshold: 1.5,
            heartbeat_interval_seconds: 120,
            telegram_alert_cooldown_seconds: 900
          })
        }
      )
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Agent Registered" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Notifications" })).getByRole("status")
    ).toHaveTextContent("Agent registered. Save the generated script.");
  });

  it("places the overview action first and requires two confirmations before discarding the one-time secret", async () => {
    apiFetchMock.mockImplementation((_path, init) =>
      init?.method === "POST" ? Promise.resolve(replacementInstallation) : Promise.resolve(agents)
    );

    renderAgentsPage();

    fireEvent.click(await screen.findByRole("button", { name: "Register Agent" }));
    fireEvent.change(screen.getByLabelText("Server Name"), { target: { value: "atlas-api-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue To Script Generation" }));
    fireEvent.change(screen.getByLabelText("Middleware API URL"), {
      target: { value: "https://api.atlas.example.com/health" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Script" }));

    const pageHeading = await screen.findByRole("heading", { level: 1, name: "Agent Registered" });
    const backButton = screen.getByRole("button", { name: "Back To Overview" });
    expect(backButton.compareDocumentPosition(pageHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(backButton);
    expect(screen.getByRole("dialog", { name: "Leave the Access Secret Page?" })).toBeInTheDocument();
    expect(screen.getByText(/cannot open this access secret or generated script again/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "I Saved The Script — Continue" }));
    expect(screen.getByRole("dialog", { name: "Confirm Leaving the Access Secret Page" })).toBeInTheDocument();
    expect(screen.getByText(/cannot be reopened/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close Page And Return To Overview" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Operations Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Agent Registered" })).not.toBeInTheDocument();
  });

  it("updates agent settings without rotating its secret", async () => {
    apiFetchMock.mockImplementation((_path, init) =>
      init?.method === "PUT" ? Promise.resolve(undefined) : Promise.resolve(agents)
    );

    renderAgentsPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit atlas-web-01" }));
    expect(
      screen.getByRole("dialog", { name: "Edit atlas-web-01" })
    ).toHaveClass("agent-dialog--agent-form");
    const nameInput = screen.getByLabelText("Server Name");
    expect(nameInput).toHaveValue("atlas-web-01");
    expect(screen.getByLabelText("RAM Usage Threshold (%)")).toHaveValue("85");
    expect(screen.getByLabelText("Storage Usage Threshold (%)")).toHaveValue("90");
    expect(screen.queryByLabelText("Middleware API URL")).not.toBeInTheDocument();
    expect(screen.queryByText(/saving keeps the current access secret/i)).not.toBeInTheDocument();
    fireEvent.change(nameInput, { target: { value: "atlas-web-renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/agents/agent-1",
        {
          method: "PUT",
          body: JSON.stringify({
            server_name: "atlas-web-renamed",
            ram_available_threshold_percent: 15,
            disk_available_threshold_percent: 10,
            load_5_per_core_threshold: 1.5,
            heartbeat_interval_seconds: 120,
            telegram_alert_cooldown_seconds: 900
          })
        }
      )
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit atlas-web-01" })).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { level: 1, name: "Agent updated" })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Notifications" })).getByRole("status")
    ).toHaveTextContent("Agent settings saved. Access secret unchanged.");
  });

  it("restores focus after closing the edit modal", async () => {
    apiFetchMock.mockResolvedValue(agents);

    renderAgentsPage();

    const editButton = await screen.findByRole("button", { name: "Edit atlas-web-01" });
    fireEvent.click(editButton);
    await waitFor(() => expect(screen.getByLabelText("Server Name")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Close Edit Form" }));
    await waitFor(() => expect(editButton).toHaveFocus());
  });

  it("opens the requested agent rotation setup without rotating automatically", async () => {
    apiFetchMock.mockResolvedValue(agents);
    renderAgentsPage("/projects/project-1?rotate_agent=agent-1");
    expect(await screen.findByRole("dialog", { name: "Rotate Access Secret For atlas-web-01?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Middleware API URL")).toHaveValue("https://atlas.example.com/api/health");
    expect(apiFetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close Access Secret Rotation" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("rejects a rotation shortcut for an agent outside the selected project", async () => {
    apiFetchMock.mockResolvedValue(agents);
    renderAgentsPage("/projects/project-1?rotate_agent=missing-agent");
    expect(await screen.findByText("The selected agent is no longer available in this project.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(apiFetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("does not open rotation shortcuts for non-admin users", async () => {
    authFixture.role = "operator"; apiFetchMock.mockResolvedValue(agents);
    renderAgentsPage("/projects/project-1?rotate_agent=agent-1");
    await screen.findByRole("heading", { name: "Registered Agents" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(apiFetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("rotates an agent secret only through explicit confirmation", async () => {
    apiFetchMock.mockImplementation((_path, init) =>
      init?.method === "POST" ? Promise.resolve(replacementInstallation) : Promise.resolve(agents)
    );

    renderAgentsPage();

    fireEvent.click(await screen.findByRole("button", { name: "Rotate atlas-web-01 Access Secret" }));
    expect(screen.getByRole("dialog", { name: "Rotate Access Secret For atlas-web-01?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Middleware API URL")).toHaveValue("https://atlas.example.com/api/health");
    expect(screen.getByText(/current script will stop authenticating immediately/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rotate And Generate Script" }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/agents/agent-1/credential-rotation",
        {
          method: "POST",
          body: JSON.stringify({ health_api_url: "https://atlas.example.com/api/health", checks: { apache: true, nginx: false, middleware_api: true } })
        }
      )
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Access Secret Rotated" })).toBeInTheDocument();
    expect(screen.getByText(/previous access secret is revoked/i)).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Notifications" })).getByRole("status")
    ).toHaveTextContent("Access secret rotated. Install the replacement script.");
  });

  it("can generate a replacement with Nginx enabled and Middleware API disabled", async () => {
    apiFetchMock.mockImplementation((_path, init) => init?.method === "POST" ? Promise.resolve(replacementInstallation) : Promise.resolve(agents));
    renderAgentsPage();
    fireEvent.click(await screen.findByRole("button", { name: "Rotate atlas-web-01 Access Secret" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Middleware API/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Nginx/ }));
    expect(screen.queryByLabelText("Middleware API URL")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rotate And Generate Script" }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/agents/agent-1/credential-rotation", {
        method: "POST", body: JSON.stringify({ health_api_url: null, checks: { apache: true, nginx: true, middleware_api: false } })
      }
    ));
  });

  it("requires confirmation before deleting and revoking an agent", async () => {
    apiFetchMock.mockImplementation((_path, init) =>
      init?.method === "DELETE" ? Promise.resolve(undefined) : Promise.resolve(agents)
    );

    renderAgentsPage();

    const deleteButton = await screen.findByRole("button", { name: "Delete atlas-web-01" });
    fireEvent.click(deleteButton);
    expect(
      screen.getByRole("dialog", { name: "Delete atlas-web-01?" })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delete atlas-web-01?" })).toBeInTheDocument();
    expect(screen.getByText(/access secret will stop working immediately/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    const closeDeleteButton = screen.getByRole("button", { name: "Close Deletion Confirmation" });
    await waitFor(() => expect(closeDeleteButton).toHaveFocus());
    fireEvent.click(closeDeleteButton);
    await waitFor(() => expect(deleteButton).toHaveFocus());
    fireEvent.click(deleteButton);
    fireEvent.click(screen.getByRole("button", { name: "Delete Agent" }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/agents/agent-1",
        { method: "DELETE" }
      )
    );
    expect(
      within(screen.getByRole("region", { name: "Notifications" })).getByRole("status")
    ).toHaveTextContent("Agent deleted. Access revoked.");
  });
});
