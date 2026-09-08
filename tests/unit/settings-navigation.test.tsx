// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "admin", api: vi.fn() }));
vi.mock("../../src/client/auth/AuthProvider", () => ({ useAuth: () => ({ status:"authenticated", user:{role:state.role,email:"admin@example.test"},logout:vi.fn(),restore:vi.fn() }) }));
vi.mock("../../src/client/projects/ProjectProvider", () => ({
  ProjectProvider: ({children}:{children:ReactNode}) => children,
  useProjects: () => ({ projects:[], selectedProject:null,status:"success",reloadProjects:vi.fn() })
}));
vi.mock("../../src/client/hooks/useMediaQuery", () => ({useMediaQuery:()=>true}));
vi.mock("../../src/client/api", async (original) => ({...await original<typeof import("../../src/client/api")>(),apiFetch:state.api}));
import { App } from "../../src/client/App";
import { ToastProvider } from "../../src/client/components/ToastProvider";
function open(path:string) { render(<MemoryRouter initialEntries={[path]}><ToastProvider><App /></ToastProvider></MemoryRouter>); }
beforeEach(()=>{state.role="admin";state.api.mockReset();state.api.mockImplementation(async (path:string)=>path==="/api/v1/admins"?[]:{telegram_bot_configured:false,telegram_chat_id:null});vi.spyOn(window,"scrollTo").mockImplementation(()=>{});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("opens the settings section from the gear and separates each feature",async()=>{
  open("/projects"); fireEvent.click(screen.getByRole("link",{name:"Settings",exact:true}));
  expect(await screen.findByRole("heading",{level:1,name:"Telegram"})).toBeInTheDocument();
  expect(screen.getByRole("navigation",{name:"Settings Navigation"})).toBeInTheDocument();
  expect(screen.getByRole("link",{name:"Telegram",exact:true})).toHaveAttribute("aria-current","page");
  fireEvent.click(screen.getByRole("link",{name:"Teams",exact:true}));
  expect(await screen.findByRole("heading",{level:1,name:"Teams"})).toBeInTheDocument();
  expect(screen.queryByLabelText("Telegram Chat ID")).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Add Admin"})).toBeInTheDocument();
  expect(screen.queryByLabelText("Admin Email")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link",{name:"Change Password",exact:true}));
  expect(await screen.findByRole("heading",{level:1,name:"Change Password"})).toBeInTheDocument();
  expect(screen.queryByLabelText("Admin Email")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Current Password")).toBeInTheDocument();
});
it("redirects the old account URL to the dedicated password page",async()=>{
  open("/account"); expect(await screen.findByRole("heading",{level:1,name:"Change Password"})).toBeInTheDocument();
  expect(screen.getByRole("link",{name:"Change Password",exact:true})).toHaveAttribute("aria-current","page");
});
it("does not expose administrator-only pages to operators",async()=>{
  state.role="operator";open("/settings/admins");
  expect(await screen.findByRole("heading",{level:1,name:"Change Password"})).toBeInTheDocument();
  expect(screen.queryByRole("link",{name:"Teams"})).not.toBeInTheDocument();
  expect(screen.queryByRole("link",{name:"Telegram"})).not.toBeInTheDocument();
  expect(state.api).not.toHaveBeenCalled();
});
