// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../../src/shared/contracts";

const { apiFetchMock, projectFixture, reloadProjectsMock } = vi.hoisted(() => ({
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
    stale_agents: 0
  } satisfies ProjectSummary,
  reloadProjectsMock: vi.fn()
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
    reloadProjects: reloadProjectsMock
  })
}));

import { ProjectSettingsPage } from "../../src/client/pages/ProjectSettingsPage";
import { ToastProvider } from "../../src/client/components/ToastProvider";

afterEach(cleanup);

describe("project Setting page", () => {
  it("keeps only project-owned thresholds and confirms a successful save", async () => {
    apiFetchMock.mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/projects/project-1/settings"]}>
          <ProjectSettingsPage />
        </MemoryRouter>
      </ToastProvider>
    );

    expect(screen.getByRole("heading", { level: 1, name: "Project Setting" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Project Thresholds" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Telegram Bot Token")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Telegram Chat ID")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Thresholds" }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledOnce());
    expect(
      within(screen.getByRole("region", { name: "Notifications" })).getByRole("status")
    ).toHaveTextContent("Project settings saved.");
  });
});
