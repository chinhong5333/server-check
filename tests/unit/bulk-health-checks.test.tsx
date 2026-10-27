// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/client/api", async (original) => ({ ...await original<typeof import("../../src/client/api")>(), apiFetch: api }));
import { BulkHealthChecksButton } from "../../src/client/components/BulkHealthChecks";
import { ToastProvider } from "../../src/client/components/ToastProvider";
import type { AgentSummary } from "../../src/shared/contracts";
afterEach(cleanup);

const agents = [
  { id: "agent-1", server_name: "web-01", checks: { apache: true, nginx: false, middleware_api: true }, health_api_url: "https://example.test/health" },
  { id: "agent-2", server_name: "web-02", checks: { apache: true, nginx: true, middleware_api: false }, health_api_url: null }
] as unknown as AgentSummary[];

it("edits checks per agent and per column, and saves only the changed agents", async () => {
  api.mockResolvedValue({ updated_count: 2 });
  const onSaved = vi.fn();
  render(<ToastProvider><BulkHealthChecksButton projectApiBase="/api/v1/projects/project-1" projectName="Atlas" agents={agents} onSaved={onSaved} /></ToastProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Bulk Health Checks" }));
  const dialog = screen.getByRole("dialog", { name: "Bulk Health Checks" });
  expect(within(dialog).getByRole("button", { name: "No Changes" })).toBeDisabled();
  expect(within(dialog).getByRole("checkbox", { name: "Middleware API For web-02" })).toBeDisabled();
  expect(within(dialog).getByRole("checkbox", { name: "Select All Apache" })).toBeChecked();
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Select All Apache" }));
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Nginx For web-01" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save 2 Agents" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({ agents: [
    { agent_id: "agent-1", checks: { apache: false, nginx: true, middleware_api: true } },
    { agent_id: "agent-2", checks: { apache: false, nginx: true, middleware_api: false } }] });
});
