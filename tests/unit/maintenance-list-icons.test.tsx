// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../../src/shared/contracts";
const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("../../src/client/api", () => ({ apiFetch }));
import { ProjectCard } from "../../src/client/components/ProjectCard";
const project: ProjectSummary = { id: "1", name: "Production", slug: "prod", healthy_agents: 8, new_agents: 0, warning_agents: 0, critical_agents: 0, stale_agents: 0,
  maintenance: { status: "active", scope: "project" }, agents_preview: [{id:"10",server_name:"API",status:"healthy",maintenance:{status:"scheduled",scope:"agent"}}] };
afterEach(cleanup);
it("shows compact project/agent markers and retains maintenance in the full roster modal", async () => {
  apiFetch.mockResolvedValue(project.agents_preview);
  render(<MemoryRouter><ProjectCard project={project} /></MemoryRouter>);
  expect(screen.getByRole("img", {name:"Project Maintenance Active"})).toHaveAttribute("title", "Project Maintenance Active");
  expect(screen.getByRole("img", {name:"Agent Maintenance Scheduled"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name:"View All 8 Agents"}));
  const dialog = screen.getByRole("dialog", {name:"All Agents"});
  expect(await within(dialog).findByRole("img", {name:"Agent Maintenance Scheduled"})).toBeInTheDocument();
  expect(within(dialog).getByText("Healthy")).toBeInTheDocument();
});
it("omits markers when maintenance metadata is absent", () => {
  render(<MemoryRouter><ProjectCard project={{...project, maintenance:null, agents_preview:[{id:"10",server_name:"API",status:"healthy"}]}} /></MemoryRouter>);
  expect(screen.queryByRole("img", {name:/Maintenance/})).not.toBeInTheDocument();
});
