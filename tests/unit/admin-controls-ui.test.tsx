// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../../src/shared/contracts";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/client/api", () => ({ apiFetch: api }));
import { CancelPendingTelegram } from "../../src/client/components/CancelPendingTelegram";
import { ProjectSortMode } from "../../src/client/components/ProjectSortMode";
import { AdminManagement } from "../../src/client/components/AdminManagement";
const projects = [{id:"one",name:"One"},{id:"two",name:"Two"}].map(project => ({...project,slug:project.id,healthy_agents:1,new_agents:0,warning_agents:0,critical_agents:0,stale_agents:0})) as ProjectSummary[];
beforeEach(() => { api.mockReset(); api.mockResolvedValue([]); });
afterEach(cleanup);

describe("admin control interfaces", () => {
  it("explains that admins have full access when the Admin role is selected", async () => {
    render(<AdminManagement />);
    fireEvent.click(screen.getByRole("button", {name:"Add Member"}));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Role"), {target:{value:"admin"}});
    expect(screen.getByRole("note")).toHaveTextContent("Full Admin Access — Cannot Be Undone");
    expect(screen.getByRole("note")).toHaveTextContent("Once created, it cannot be suspended or changed to a sub-admin through Teams.");
    expect(screen.getByRole("note")).toHaveTextContent("This action cannot be undone through Teams.");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("shows a structured team list with roles, joined dates, and member count", async () => {
    api.mockResolvedValue([{id:"one",email:"admin@example.test",created_at:1_788_252_000_000}]);
    render(<AdminManagement />);
    expect(await screen.findByRole("table",{name:"Team Members"})).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map(header=>header.textContent)).toEqual(["Email Address","Role","Permissions","Joined","Actions"]);
    expect(screen.getByText("Total 1 Member")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.queryByLabelText("Member Email")).not.toBeInTheDocument();
  });
  it("cancels admin creation, clears entered values, and restores focus", async () => {
    render(<AdminManagement />);
    const trigger=screen.getByRole("button",{name:"Add Member"});fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText("Member Email"),{target:{value:"discard@example.test"}});
    fireEvent.change(screen.getByLabelText("New Password"),{target:{value:"discard synthetic password"}});
    fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
    await waitFor(()=>expect(trigger).toHaveFocus());
    expect(api.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
    fireEvent.click(trigger);
    expect(screen.getByLabelText("Member Email")).toHaveValue("");
    expect(screen.getByLabelText("New Password")).toHaveValue("");
  });
  it("requires both confirmation steps before cancelling agent messages", async () => {
    api.mockResolvedValue({cancelled_count:3}); const done = vi.fn();
    render(<CancelPendingTelegram agentId="agent-1" agentName="Atlas" onCancelled={done} />);
    fireEvent.click(screen.getByText("Clear Pending Messages"));
    expect(screen.getByRole("dialog")).toHaveTextContent("Atlas");
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Continue"));
    expect(screen.getByRole("heading",{name:"Confirm Cancellation"})).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirm Clear Pending"));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith("/api/v1/agents/agent-1/telegram-deliveries/cancel-pending",{method:"POST",body:'{"confirm":true}'});
    expect(screen.getByRole("status")).toHaveTextContent("3 pending");
  });
  it("keeps messages without making a request when confirmation is abandoned", () => {
    render(<CancelPendingTelegram agentId="agent-1" agentName="Atlas" onCancelled={vi.fn()} />);
    fireEvent.click(screen.getByText("Clear Pending Messages")); fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(screen.getByText("Keep Messages")); expect(api).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("saves reordered IDs only after Save Order", async () => {
    const saved=vi.fn(); render(<ProjectSortMode projects={projects} onClose={vi.fn()} onSaved={saved} />);
    fireEvent.click(screen.getByRole("button",{name:"Move Two Earlier"}));
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("list")).toHaveClass("project-card-grid");
    expect(screen.getAllByText("Total Agents")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Two"); expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save Order")); await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith("/api/v1/projects/order",{method:"PUT",body:JSON.stringify({ordered_ids:["two","one"],expected_ids:["one","two"]})});
  });
  it("supports drag reordering and Cancel without saving", () => {
    const close=vi.fn(); render(<ProjectSortMode projects={projects} onClose={close} onSaved={vi.fn()} />);
    const [one,two]=screen.getAllByRole("listitem");
    fireEvent.dragStart(two,{dataTransfer:{setData:vi.fn()}}); fireEvent.dragOver(one); fireEvent.drop(one);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Two");
    fireEvent.click(screen.getByText("Cancel")); expect(close).toHaveBeenCalledOnce(); expect(api).not.toHaveBeenCalled();
  });
  it("keeps the sort draft and displays a save conflict", async () => {
    api.mockRejectedValue(new Error("Project list changed"));
    render(<ProjectSortMode projects={projects} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByText("Save Order")); expect(await screen.findByRole("alert")).toHaveTextContent("Project list changed");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
  it("creates an admin only with matching confirmation and clears passwords afterward", async () => {
    render(<AdminManagement />); await screen.findByText("Add Member");
    fireEvent.click(screen.getByRole("button",{name:"Add Member"}));
    fireEvent.change(screen.getByLabelText("Member Email"),{target:{value:"new@example.test"}});
    fireEvent.change(screen.getByLabelText("New Password"),{target:{value:"SyntheticNew1!"}});
    fireEvent.change(screen.getByLabelText("Confirm Password"),{target:{value:"wrong synthetic password"}});
    fireEvent.change(screen.getByLabelText("Your Current Password"),{target:{value:"synthetic current"}});
    fireEvent.click(screen.getByText("Create Member"));
    expect(screen.getByRole("alert")).toHaveTextContent("do not match");
    expect(api.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Confirm Password"),{target:{value:"SyntheticNew1!"}});
    fireEvent.click(screen.getByText("Create Member"));
    await screen.findByText(/team member was created/);
    expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Your Current Password")).not.toBeInTheDocument();
  });
});
