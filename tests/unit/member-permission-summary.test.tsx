// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PERMISSIONS } from "../../src/shared/permissions";
import { MemberPermissionSummary } from "../../src/client/components/MemberPermissionSummary";
afterEach(cleanup);
it("keeps all seven permissions out of the row until opened and restores focus", async () => {
  render(<MemberPermissionSummary member={{id:"sub",email:"sub@example.test",permissions:PERMISSIONS.map(p=>p.key)}} />);
  const button=screen.getByRole("button",{name:"View Permissions For sub@example.test"});
  expect(button).toHaveTextContent("7 Permissions");
  expect(screen.queryByText("Manage Global Settings")).not.toBeInTheDocument();
  fireEvent.click(button);
  expect(screen.getByRole("dialog",{name:"Assigned Permissions"})).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(7);
  fireEvent.click(screen.getByRole("button",{name:"Close Permissions View"}));
  await waitFor(()=>expect(button).toHaveFocus());
});
it("shows no permissions without an empty popup", () => {
  render(<MemberPermissionSummary member={{id:"sub",email:"sub@example.test",permissions:[]}} />);
  expect(screen.getByText("No Permissions")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
