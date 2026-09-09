// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { api } = vi.hoisted(()=>({api:vi.fn()}));
vi.mock("../../src/client/api",()=>({apiFetch:api}));
import { RotateAgentSecretButton } from "../../src/client/components/RotateAgentSecretButton";
const result={agent_id:"agent-1",script_filename:"synthetic.sh",script:"#!/bin/sh\n# synthetic replacement",crontab_entry:"* * * * * /synthetic.sh",credential_shown_once:true};
function Location(){return <output data-testid="location">{useLocation().pathname}</output>;}
function show(onFinished=vi.fn()){
  render(<MemoryRouter initialEntries={["/projects/project-1/agents/agent-1"]}><Location /><RotateAgentSecretButton
    agentId="agent-1" projectId="project-1" agentName="Atlas" healthApiUrl="https://example.test/health" onFinished={onFinished} /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button",{name:"Rotate Secret"}));return onFinished;
}
beforeEach(()=>{api.mockReset();api.mockResolvedValue(result);});
afterEach(cleanup);
it("confirms and displays the replacement script without leaving Agent Detail",async()=>{
  const finished=show();expect(api).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toHaveTextContent("old script");
  fireEvent.click(screen.getByRole("button",{name:"Rotate And Generate Script"}));
  await screen.findByRole("heading",{name:"Access Secret Rotated"});
  expect(screen.getByTestId("location")).toHaveTextContent("/projects/project-1/agents/agent-1");
  expect(screen.getByLabelText("Replacement Agent Script")).toHaveTextContent("synthetic replacement");
  expect(screen.getByRole("button",{name:"Download Script"})).toBeInTheDocument();
  expect(finished).not.toHaveBeenCalled();
  expect(api.mock.calls[0][0]).toBe("/api/v1/projects/project-1/agents/agent-1/credential-rotation");
  expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({health_api_url:"https://example.test/health",checks:{apache:true,nginx:false,middleware_api:true}});
  fireEvent.click(screen.getByRole("button",{name:"Close Secret Rotation"}));
  fireEvent.click(screen.getByRole("button",{name:"Continue"}));
  expect(finished).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Close Script"}));
  await waitFor(()=>expect(finished).toHaveBeenCalledOnce());
  expect(screen.queryByLabelText("Replacement Agent Script")).not.toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent("/projects/project-1/agents/agent-1");
});
it("does not rotate when cancelled and returns focus to the trigger",async()=>{
  show();fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Rotate Secret"})).toHaveFocus());expect(api).not.toHaveBeenCalled();
});
it("retains the confirmation on request failure and allows retry",async()=>{
  api.mockRejectedValueOnce(new Error("Connection failed"));show();
  fireEvent.click(screen.getByRole("button",{name:"Rotate And Generate Script"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection failed");
  expect(screen.getByTestId("location")).toHaveTextContent("/projects/project-1/agents/agent-1");
  expect(screen.getByRole("button",{name:"Rotate And Generate Script"})).toBeEnabled();
});
