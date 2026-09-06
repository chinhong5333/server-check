// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../../src/shared/contracts";

const { apiFetchMock, projectFixture, healthyProjectFixture, reloadProjectsMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  projectFixture: {
    id: "project-1",
    name: "Project Atlas",
    slug: "project-atlas",
    ram_available_threshold_percent: 15,
    disk_available_threshold_percent: 10,
    load_5_per_core_threshold: 1,
    heartbeat_interval_seconds: 120,
    healthy_agents: 2,
    new_agents: 0,
    warning_agents: 0,
    critical_agents: 0,
    stale_agents: 1
  } satisfies ProjectSummary,
  healthyProjectFixture: {
    id: "project-2",
    name: "Project Green",
    slug: "project-green",
    healthy_agents: 2,
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
    projects: [projectFixture, healthyProjectFixture],
    status: "success",
    error: null,
    reloadProjects: reloadProjectsMock
  })
}));

import { CreateProjectPage } from "../../src/client/pages/CreateProjectPage";
import { ProjectActions } from "../../src/client/components/ProjectActions";
import { ProjectsPage } from "../../src/client/pages/ProjectsPage";
import { ToastProvider } from "../../src/client/components/ToastProvider";

afterEach(cleanup);

describe("Projects collection flow", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    reloadProjectsMock.mockReset();
  });

  it("keeps project creation open until its close button is used", async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/projects"]}>
          <ProjectsPage />
        </MemoryRouter>
      </ToastProvider>
    );

    expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
    expect(screen.getByText("Project Atlas")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Project Atlas" })).toHaveAttribute(
      "title",
      "Project Atlas"
    );
    const failedProject = screen.getByRole("article", { name: "Project Atlas" });
    expect(within(failedProject).getByLabelText("Total Agents: 3")).toBeInTheDocument();
    expect(within(failedProject).getByText("Error")).toBeInTheDocument();
    expect(within(failedProject).getByText("1 agent needs attention.")).toBeInTheDocument();
    expect(within(failedProject).getByRole("link", { name: "Manage" })).toBeInTheDocument();
    expect(within(failedProject).queryByRole("button")).not.toBeInTheDocument();
    const healthyProject = screen.getByRole("article", { name: "Project Green" });
    expect(within(healthyProject).getByLabelText("Total Agents: 2")).toBeInTheDocument();
    expect(within(healthyProject).getByText("Healthy")).toBeInTheDocument();
    expect(within(healthyProject).getByText("All registered agents are healthy.")).toBeInTheDocument();
    const createButton = screen.getByRole("button", { name: "Create Project" });
    expect(createButton).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByLabelText("Project Name")).not.toBeInTheDocument();

    fireEvent.click(createButton);
    const dialog = screen.getByRole("dialog", { name: "Create Project" });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Project Name")).toHaveFocus());
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Project" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveFocus());
    const cancelEvent = new Event("cancel", { bubbles: true, cancelable: true });
    fireEvent(dialog, cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog", { name: "Create Project" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Project Creation" }));
    await waitFor(() => expect(createButton).toHaveFocus());
  });

  it("creates a project from the modal with the canonical API payload", async () => {
    apiFetchMock.mockResolvedValue({ id: "project-2" });

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/projects"]}>
          <Routes>
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<p>New project workspace</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    fireEvent.change(screen.getByLabelText("Project Name"), { target: { value: "Project Beacon" } });
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Create Project" })).getByRole("button", {
        name: "Create Project"
      })
    );

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: "Project Beacon" })
      })
    );
    expect(reloadProjectsMock).toHaveBeenCalledOnce();
    expect(await screen.findByText("New project workspace")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Notifications" })).getByRole("status")
    ).toHaveTextContent("Project created.");
  });

  it("renames a project from a close-button-only modal", async () => {
    apiFetchMock.mockResolvedValue(undefined);

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/projects"]}>
          <ProjectActions project={projectFixture} />
        </MemoryRouter>
      </ToastProvider>
    );

    const renameTrigger = screen.getByRole("button", { name: "Rename Project" });
    fireEvent.click(renameTrigger);
    const dialog = screen.getByRole("dialog", { name: "Rename Project" });
    expect(dialog).toHaveClass("agent-dialog--project-rename");
    const nameInput = within(dialog).getByLabelText("Project Name");
    expect(nameInput.closest(".field")).toHaveClass("field--wide");
    await waitFor(() => expect(nameInput).toHaveFocus());
    expect(nameInput).toHaveValue("Project Atlas");

    const cancelEvent = new Event("cancel", { bubbles: true, cancelable: true });
    fireEvent(dialog, cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog", { name: "Rename Project" })).toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: "Project Beacon" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Name" }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/projects/project-1", {
        method: "PUT",
        body: JSON.stringify({ name: "Project Beacon" })
      })
    );
    expect(reloadProjectsMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Rename Project" })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Notifications" })).getByRole("status")
    ).toHaveTextContent("Project name updated.");
  });

  it("requires two confirmations before deleting a project", async () => {
    apiFetchMock.mockResolvedValue(undefined);

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/projects"]}>
          <ProjectActions project={projectFixture} />
        </MemoryRouter>
      </ToastProvider>
    );

    const deleteTrigger = screen.getByRole("button", { name: "Delete Project" });
    fireEvent.click(deleteTrigger);
    const firstConfirmation = screen.getByRole("dialog", { name: "Delete Project Atlas?" });
    expect(within(firstConfirmation).queryByLabelText("Project Name")).not.toBeInTheDocument();
    expect(within(firstConfirmation).getByText("Confirmation 1 of 2", { exact: false })).toBeInTheDocument();

    fireEvent.click(within(firstConfirmation).getByRole("button", { name: "Continue Deletion" }));
    const finalConfirmation = screen.getByRole("dialog", { name: "Final Confirmation" });
    const confirmationInput = within(finalConfirmation).getByLabelText("Project Name");
    const finalDelete = within(finalConfirmation).getByRole("button", { name: "Delete Project" });
    await waitFor(() => expect(confirmationInput).toHaveFocus());
    expect(finalDelete).toBeDisabled();

    fireEvent.change(confirmationInput, { target: { value: "Wrong project" } });
    expect(finalDelete).toBeDisabled();
    fireEvent.change(confirmationInput, { target: { value: "Project Atlas" } });
    expect(finalDelete).toBeEnabled();
    fireEvent.click(finalDelete);

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/projects/project-1", {
        method: "DELETE",
        body: JSON.stringify({ confirmation_name: "Project Atlas" })
      })
    );
    expect(reloadProjectsMock).toHaveBeenCalledOnce();
    expect(
      within(screen.getByRole("region", { name: "Notifications" })).getByRole("status")
    ).toHaveTextContent("Project deleted. Agent access revoked.");
  });

  it("redirects the former creation page to the Projects collection", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/new"]}>
        <Routes>
          <Route path="/projects/new" element={<CreateProjectPage />} />
          <Route path="/projects" element={<p>Projects collection</p>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Projects collection")).toBeInTheDocument();
  });
});
