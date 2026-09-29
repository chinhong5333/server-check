// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/client/api", () => ({ apiFetch: api }));
import { MaintenanceControl } from "../../src/client/components/MaintenanceControl";
afterEach(cleanup);
it("keeps invalid schedule input visible and submits only the canonical fields after correction", async () => {
  api.mockImplementation(async (_path, init) => init?.method === "POST" ? undefined : { own: null, inherited: null, server_time: Date.now() });
  render(<MaintenanceControl endpoint="/synthetic/maintenance" scope="Agent" canManage />);
  fireEvent.click(await screen.findByRole("button", { name: "Schedule Maintenance" }));
  fireEvent.change(screen.getByLabelText("End Time"), { target: { value: "2000-01-01T00:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Maintenance" }));
  expect(screen.getByText("Choose an end after the start, within 30 days.")).toBeInTheDocument();
  expect(api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  const at = Date.now() + 3600000, date = new Date(at);
  const end = new Date(at - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  fireEvent.change(screen.getByLabelText("End Time"), { target: { value: end } });
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Scheduled test update" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Maintenance" }));
  await waitFor(() => expect(api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
  const sent = api.mock.calls.find(([, init]) => init?.method === "POST")![1];
  expect(JSON.parse(sent.body)).toEqual({ starts_at: null, ends_at: new Date(end).getTime(), reason: "Scheduled test update" });
});

it("places the schedule action in the toolbar and hides empty maintenance details", async () => {
  api.mockImplementation(async () => ({ own: null, inherited: null, server_time: Date.now() }));
  render(<><div data-testid="toolbar"><button>Rename Project</button><MaintenanceControl endpoint="/synthetic/maintenance" scope="Project" canManage detailsTargetId="details" /><button>Delete Project</button></div><div id="details" /></>);
  const schedule = await screen.findByRole("button", { name: "Schedule Maintenance" });
  await waitFor(() => expect(schedule).toBeEnabled());
  expect([...screen.getByTestId("toolbar").querySelectorAll("button")].map(button => button.textContent)).toEqual(["Rename Project", "Schedule Maintenance", "Delete Project"]);
  expect(screen.queryByRole("region", { name: "Project Maintenance" })).not.toBeInTheDocument();
  fireEvent.click(schedule);
  expect(screen.getByRole("dialog", { name: "Schedule Project Maintenance" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close Maintenance" }));
  await waitFor(() => expect(schedule).toHaveFocus());
});

it.each(["scheduled", "active"] as const)("shows %s window details in the separate slot", async status => {
  api.mockImplementation(async () => ({ own: { id: "window", scope: "project", status, starts_at: Date.now(), ends_at: Date.now() + 3600000, reason: "Server update" }, inherited: null, server_time: Date.now() }));
  render(<><div data-testid="toolbar"><MaintenanceControl endpoint="/synthetic/maintenance" scope="Project" canManage detailsTargetId="details" /></div><div id="details" /></>);
  const region = await screen.findByRole("region", { name: "Project Maintenance" });
  expect(region.parentElement).toHaveAttribute("id", "details");
  expect(screen.getByRole("button", { name: status === "active" ? "End Maintenance Now" : "Cancel Maintenance" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Schedule Maintenance" })).not.toBeInTheDocument();
});

it("keeps inherited maintenance visible to viewers without exposing toolbar actions", async () => {
  api.mockImplementation(async () => ({ own: null, inherited: { id: "window", scope: "project", status: "active", starts_at: Date.now(), ends_at: Date.now() + 3600000, reason: "Server update" }, server_time: Date.now() }));
  render(<><div hidden><MaintenanceControl endpoint="/synthetic/maintenance" scope="Agent" canManage={false} detailsTargetId="details" /></div><div id="details" /></>);
  expect(await screen.findByRole("region", { name: "Agent Maintenance" })).toHaveTextContent("Project Maintenance Active");
  expect(screen.queryByRole("button", { name: "Schedule Maintenance" })).not.toBeInTheDocument();
});

it("keeps the empty section hidden on load failure and provides a toolbar retry", async () => {
  api.mockImplementation(async () => { throw new Error("Unavailable"); });
  render(<><MaintenanceControl endpoint="/synthetic/maintenance" scope="Agent" canManage detailsTargetId="details" /><div id="details" /></>);
  expect(await screen.findByRole("button", { name: "Retry Maintenance" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Schedule Maintenance" })).toBeDisabled();
  expect(screen.queryByRole("region", { name: "Agent Maintenance" })).not.toBeInTheDocument();
});
