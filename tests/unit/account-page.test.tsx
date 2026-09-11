// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { api, restore } = vi.hoisted(() => ({ api: vi.fn(), restore: vi.fn() }));
vi.mock("../../src/client/api", async (original) => ({ ...await original<typeof import("../../src/client/api")>(), apiFetch: api }));
vi.mock("../../src/client/auth/AuthProvider", () => ({ useAuth: () => ({ user: { email: "admin@example.test" }, restore }) }));
import { AccountPage } from "../../src/client/pages/AccountPage";
import { ToastProvider } from "../../src/client/components/ToastProvider";

function renderAccount() {
  render(<ToastProvider><MemoryRouter initialEntries={["/account"]}><Routes>
    <Route path="/account" element={<AccountPage />} /><Route path="/login" element={<p>Sign In Again</p>} />
  </Routes></MemoryRouter></ToastProvider>);
  fireEvent.change(screen.getByLabelText("Current Password"), { target: { value: "old synthetic passphrase" } });
  fireEvent.change(screen.getByLabelText("New Password"), { target: { value: "NewSynthetic1!" } });
}
describe("Account password form", () => {
  beforeEach(() => { api.mockReset(); restore.mockReset(); });
  afterEach(cleanup);
  it("blocks mismatched confirmation and focuses the error", async () => {
    renderAccount();
    fireEvent.change(screen.getByLabelText("Confirm New Password"), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: "Change Password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("do not match");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
    expect(api).not.toHaveBeenCalled();
  });
  it("submits only canonical password fields and returns to sign in", async () => {
    api.mockResolvedValue(undefined); restore.mockResolvedValue(undefined); renderAccount();
    fireEvent.change(screen.getByLabelText("Confirm New Password"), { target: { value: "NewSynthetic1!" } });
    fireEvent.click(screen.getByRole("button", { name: "Change Password" }));
    await screen.findByText("Sign In Again");
    expect(api).toHaveBeenCalledWith("/api/v1/auth/password", { method: "POST", body: JSON.stringify({
      current_password: "old synthetic passphrase", new_password: "NewSynthetic1!"
    }) });
    expect(restore).toHaveBeenCalledOnce();
  });
});
