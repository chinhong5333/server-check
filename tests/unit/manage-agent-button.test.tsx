// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { api } = vi.hoisted(() => ({ api:vi.fn() }));
vi.mock("../../src/client/api", () => ({ apiFetch:api }));
import { ManageAgentButton } from "../../src/client/components/ManageAgentButton";
import { ToastProvider } from "../../src/client/components/ToastProvider";
const settings={id:"agent-1",server_name:"Atlas",ram_available_threshold_percent:15,disk_available_threshold_percent:10,
  load_5_per_core_threshold:1.5,heartbeat_interval_seconds:120,telegram_alert_cooldown_seconds:900};
beforeEach(()=>{api.mockReset();});
afterEach(cleanup);
function show(onSaved=vi.fn()) {render(<ToastProvider><ManageAgentButton agentId="agent-1" projectId="project-1" agentName="Atlas" onSaved={onSaved} /></ToastProvider>);fireEvent.click(screen.getByRole("button",{name:"Manage"}));return onSaved;}
it("loads the selected agent settings and saves through the existing edit endpoint",async()=>{
  api.mockImplementation(async(_path:string,init?:RequestInit)=>init?.method==="PUT"?undefined:[settings]);
  const saved=show();expect(await screen.findByLabelText("Server Name")).toHaveValue("Atlas");
  expect(api).toHaveBeenCalledWith("/api/v1/projects/project-1/agents",expect.objectContaining({signal:expect.any(AbortSignal)}));
  fireEvent.change(screen.getByLabelText("Server Name"),{target:{value:"Atlas Updated"}});
  fireEvent.click(screen.getByRole("button",{name:"Save Changes"}));
  await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
  const call=api.mock.calls.find(([,init])=>init?.method==="PUT")!;
  expect(call[0]).toBe("/api/v1/projects/project-1/agents/agent-1");
  expect(JSON.parse(call[1].body)).toEqual({server_name:"Atlas Updated",ram_available_threshold_percent:15,disk_available_threshold_percent:10,
    load_5_per_core_threshold:1.5,heartbeat_interval_seconds:120,telegram_alert_cooldown_seconds:900});
  await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});
it("aborts loading and makes no write when closed",async()=>{
  api.mockImplementation(()=>new Promise(()=>{}));show();
  fireEvent.click(screen.getByRole("button",{name:"Close Agent Settings"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Manage"})).toHaveFocus());
  expect(api.mock.calls[0][1].signal.aborted).toBe(true);
  expect(api.mock.calls.some(([,init])=>init?.method==="PUT")).toBe(false);
});
it("offers retry for load errors and preserves the form on save failure",async()=>{
  api.mockRejectedValueOnce(new Error("Offline"));show();
  await screen.findByText("Offline");api.mockResolvedValueOnce([settings]);
  fireEvent.click(screen.getByRole("button",{name:"Try Again"}));
  await screen.findByLabelText("Server Name");api.mockRejectedValueOnce(new Error("Save failed"));
  fireEvent.click(screen.getByRole("button",{name:"Save Changes"}));
  expect(await screen.findByText("Save failed")).toBeInTheDocument();
  expect(screen.getByLabelText("Server Name")).toHaveValue("Atlas");
});
