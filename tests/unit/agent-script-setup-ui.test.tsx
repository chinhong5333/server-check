// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentScriptSetup } from "../../src/client/components/AgentScriptSetup";
afterEach(cleanup);
const installation = {agent_id:"synthetic",script_filename:"original.sh",script:"#!/bin/sh\n# synthetic only\n",crontab_entry:"*/2 * * * * /bin/sh '/opt/server-check/original.sh'",credential_shown_once:true as const};
it("moves from download to setup and exposes three separate commands ending in an immediate central report", () => {
  render(<AgentScriptSetup installation={installation}/>);
  expect(screen.queryByRole("textbox",{name:"Script Path"})).not.toBeInTheDocument();
  expect(screen.getByText("original.sh",{exact:true})).toBeInTheDocument();
  expect(screen.getByText("View Script").parentElement).not.toHaveAttribute("open");
  expect(screen.queryByRole("button",{name:"Copy Setup Command"})).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Copy Script"})).toHaveTextContent(/^Copy$/);
  expect(screen.getByText("Save this one-time script, then upload it to the path below on your server.")).toBeInTheDocument();
  fireEvent.click(screen.getByText("View Script"));
  fireEvent.click(screen.getByRole("button",{name:"Next: Run Setup"}));
  expect(screen.getByRole("heading",{name:"Run The Setup Command"})).toHaveFocus();
  expect(screen.getByRole("textbox",{name:"Script Path"})).toHaveValue("/opt/server-check/original.sh");
  expect(screen.queryByText(/^Paste this command on your server/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("One-Line Setup Command")).toHaveTextContent("chmod 700 '/opt/server-check/original.sh'");
  expect(screen.getByLabelText("One-Line Setup Command")).toHaveTextContent(/&& \/bin\/sh '\/opt\/server-check\/original.sh'$/);
  expect(screen.getByRole("button",{name:"Copy Setup Command"})).toHaveTextContent(/^Copy$/);
  expect(screen.queryByText(/^Run as the server user who runs PM2/)).not.toBeInTheDocument();
  expect(screen.getByText("Use Separate Commands").parentElement).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText("Use Separate Commands"));
  expect(screen.getByRole("button",{name:"Copy Permissions Command"})).toHaveTextContent(/^Copy$/);
  expect(screen.getByRole("button",{name:"Copy Cron Command"})).toHaveTextContent(/^Copy$/);
  expect(screen.getByRole("button",{name:"Copy Run Command"})).toHaveTextContent(/^Copy$/);
  expect(screen.getByLabelText("3. Run And Report To Central Server")).toHaveTextContent("/bin/sh '/opt/server-check/original.sh'");
});
it.each(["success", "failure"])("preserves %s feedback and the exact copied setup command with short labels", async outcome => {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writeText = outcome === "success" ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error("Synthetic clipboard failure"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    render(<AgentScriptSetup installation={installation}/>);
    fireEvent.click(screen.getByRole("button", { name: "Next: Run Setup" }));
    const button = screen.getByRole("button", { name: "Copy Setup Command" });
    const command = screen.getByLabelText("One-Line Setup Command").textContent;
    expect(button).toHaveTextContent(/^Copy$/);
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: outcome === "success" ? "Copied" : "Copy Failed" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(command);
  } finally {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});
it("retains the edited path and unchanged script when returning to download", () => {
  render(<AgentScriptSetup installation={installation} compact/>);
  fireEvent.click(screen.getByRole("button",{name:"Next: Run Setup"}));
  fireEvent.change(screen.getByRole("textbox",{name:"Script Path"}), {target:{value:"/root/renamed.sh"}});
  fireEvent.click(screen.getByRole("button",{name:"Back To Download"}));
  expect(screen.getByText("renamed.sh",{exact:true})).toBeInTheDocument();
  expect(screen.getByText("/root/renamed.sh",{exact:true})).toBeInTheDocument();
  fireEvent.click(screen.getByText("View Script"));
  expect(screen.getByLabelText("Replacement Agent Script")).toHaveTextContent("synthetic only");
  expect(screen.getByRole("button",{name:"Download Script"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Next: Run Setup"}));
  expect(screen.getByRole("textbox",{name:"Script Path"})).toHaveValue("/root/renamed.sh");
});
it("updates every command immediately without API writes or changing the installation response", () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  const response = Object.freeze({...installation});
  try {
    render(<AgentScriptSetup installation={response}/>);
    fireEvent.click(screen.getByRole("button",{name:"Next: Run Setup"}));
    fireEvent.change(screen.getByRole("textbox",{name:"Script Path"}),{target:{value:"/root/myfile.sh"}});
    expect(screen.getByLabelText("One-Line Setup Command")).toHaveTextContent("chmod 700 '/root/myfile.sh'");
    expect(screen.getByLabelText("One-Line Setup Command")).toHaveTextContent("*/2 * * * * /bin/sh");
    expect(screen.getByLabelText("One-Line Setup Command")).toHaveTextContent(/&& \/bin\/sh '\/root\/myfile.sh'$/);
    expect(screen.getByLabelText("One-Line Setup Command")).not.toHaveTextContent("original.sh");
    fireEvent.click(screen.getByText("Use Separate Commands"));
    for (const label of ["1. Set File Permissions","2. Register The Cron Job","3. Run And Report To Central Server"]) expect(screen.getByLabelText(label)).toHaveTextContent("/root/myfile.sh");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response).toEqual(installation);
  } finally { vi.unstubAllGlobals(); }
});
it.each(["", "/root/unsafe;command.sh"])("blocks an invalid path %s and allows recovery without stale copy targets", scriptPath => {
  render(<AgentScriptSetup installation={installation}/>);
  fireEvent.click(screen.getByRole("button",{name:"Next: Run Setup"}));
  const input = screen.getByRole("textbox",{name:"Script Path"});
  fireEvent.change(input,{target:{value:scriptPath}});
  expect(input).toHaveAttribute("aria-invalid","true");
  expect(input).toHaveAccessibleDescription(/absolute Linux path ending in .sh/);
  expect(screen.queryByRole("button",{name:"Copy Setup Command"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Back To Download"}));
  expect(screen.getByRole("button",{name:"Next: Run Setup"})).toBeEnabled();
  fireEvent.click(screen.getByRole("button",{name:"Next: Run Setup"}));
  fireEvent.change(screen.getByRole("textbox",{name:"Script Path"}),{target:{value:"/root/recovered.sh"}});
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("One-Line Setup Command")).toHaveTextContent("/root/recovered.sh");
});
it("keeps the script available but blocks setup for an invalid generated command", () => {
  render(<AgentScriptSetup installation={{...installation,crontab_entry:"invalid"}}/>);
  expect(screen.getByRole("alert")).toHaveTextContent("generated cron schedule is unsupported");
  expect(screen.getByRole("button",{name:"Next: Run Setup"})).toBeDisabled();
  expect(screen.getByRole("button",{name:"Copy Script"})).toBeEnabled();
  expect(screen.queryByRole("button",{name:"Copy Setup Command"})).not.toBeInTheDocument();
});
