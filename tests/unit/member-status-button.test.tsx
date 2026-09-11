// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const {api}=vi.hoisted(()=>({api:vi.fn()}));
vi.mock("../../src/client/api",()=>({apiFetch:api}));
import {MemberStatusButton} from "../../src/client/components/MemberStatusButton";
beforeEach(()=>{api.mockReset();});afterEach(cleanup);
it.each([true,false])("confirms before changing enabled=%s",async enabled=>{
  api.mockResolvedValue(undefined);const saved=vi.fn();
  render(<MemberStatusButton member={{id:"sub",email:"sub@example.test",enabled}} onSaved={saved}/>);
  const action=enabled?"Disable":"Enable";
  fireEvent.click(screen.getByRole("button",{name:`${action} sub@example.test`}));
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:`${action} Sub-Admin`}));
  await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith("/api/v1/admins/sub/status",{method:"PATCH",body:JSON.stringify({enabled:!enabled})});
});
it("allows cancellation without changing status",()=>{
  render(<MemberStatusButton member={{id:"sub",email:"sub@example.test",enabled:true}} onSaved={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button",{name:"Disable sub@example.test"}));
  fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
  expect(api).not.toHaveBeenCalled();
});
