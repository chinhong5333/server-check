// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PermissionChecklist } from "../../src/client/components/PermissionChecklist";
import type { Permission } from "../../src/shared/permissions";
afterEach(cleanup);
it("keeps edit, delete, and rotation separate and supplies required view access", () => {
  function Example() { const [value,setValue] = useState<Permission[]>([]); return <PermissionChecklist value={value} onChange={setValue} />; }
  render(<Example />);
  expect(screen.getAllByRole("checkbox")).toHaveLength(7);
  fireEvent.click(screen.getByLabelText("Register & Edit Agents"));
  expect(screen.getByLabelText("View All Projects & Agents")).toBeChecked();
  expect(screen.getByLabelText("View All Projects & Agents")).toBeDisabled();
  expect(screen.getByLabelText("Delete Agents")).not.toBeChecked();
  expect(screen.getByLabelText("Rotate Agent Secrets")).not.toBeChecked();
  fireEvent.click(screen.getByLabelText("Register & Edit Agents"));
  expect(screen.getByLabelText("View All Projects & Agents")).toBeEnabled();
});
