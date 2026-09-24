// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../../src/shared/contracts";

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("../../src/client/api", () => ({ apiFetch: apiFetchMock }));
import { ProjectCard } from "../../src/client/components/ProjectCard";

const preview = [
  { id: "critical", server_name: "coincat-api-01", status: "critical" as const },
  { id: "warning", server_name: "coincat-worker-02", status: "warning" as const },
  { id: "stale", server_name: "coincat-database-03", status: "stale" as const },
  { id: "new", server_name: "coincat-node-10", status: "new" as const },
  { id: "healthy-1", server_name: "coincat-node-12", status: "healthy" as const },
  { id: "healthy-2", server_name: "coincat-node-11", status: "healthy" as const }
];
const project: ProjectSummary = {
  id: "project-1", name: "Coincat Server (Production)", slug: "coincat-server",
  healthy_agents: 8, new_agents: 1, warning_agents: 1, critical_agents: 1, stale_agents: 1,
  agents_preview: preview
};
const fullRoster = [...preview, ...Array.from({ length: 6 }, (_, index) => ({
  id: `healthy-${index + 3}`, server_name: `coincat-node-${index + 4}`, status: "healthy" as const
}))];

function showCard(value: ProjectSummary = project, sortingControls?: React.ReactNode) {
  render(<MemoryRouter><ProjectCard project={value} sortingControls={sortingControls} /></MemoryRouter>);
}

beforeEach(() => { apiFetchMock.mockReset(); });
afterEach(cleanup);

describe("Project card agent preview", () => {
  it("shows attention states first and uses the sixth tile to open the full roster", async () => {
    apiFetchMock.mockResolvedValue(fullRoster);
    showCard();
    const card = screen.getByRole("article", { name: project.name });
    const section = within(card).getByRole("region", { name: "Agents" });
    expect([...section.querySelectorAll("li[data-status]")].map((item) => item.getAttribute("data-status")))
      .toEqual(["critical", "warning", "stale", "new", "healthy"]);
    expect(within(section).getAllByRole("listitem")).toHaveLength(6);
    const trigger = within(section).getByRole("button", { name: "View All 12 Agents" });
    fireEvent.click(trigger);
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/projects/project-1/agents", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const dialog = screen.getByRole("dialog", { name: "All Agents" });
    expect(within(dialog).getByText(project.name)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(12));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close All Agents" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows all six agents without a View All tile when the project has exactly six", () => {
    showCard({ ...project, healthy_agents: 2 });
    const section = screen.getByRole("region", { name: "Agents" });
    expect(within(section).getAllByRole("listitem")).toHaveLength(6);
    expect(within(section).queryByRole("button", { name: /View All/ })).not.toBeInTheDocument();
  });

  it("keeps the roster modal open with a retry action when loading fails", async () => {
    apiFetchMock.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce(fullRoster);
    showCard();
    fireEvent.click(screen.getByRole("button", { name: "View All 12 Agents" }));
    const dialog = screen.getByRole("dialog", { name: "All Agents" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Connection lost");
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry Loading Agents" }));
    await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(12));
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it("omits roster controls while cards are being sorted", () => {
    showCard(project, <span>Drag To Reorder</span>);
    expect(screen.queryByRole("region", { name: "Agents" })).not.toBeInTheDocument();
    expect(screen.getByText("Drag To Reorder")).toBeInTheDocument();
  });
});
