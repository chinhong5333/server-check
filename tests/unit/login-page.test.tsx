// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }));

vi.mock("../../src/client/auth/AuthProvider", () => ({
  useAuth: () => ({
    status: "anonymous",
    login: loginMock
  })
}));

import { ToastProvider } from "../../src/client/components/ToastProvider";
import { LoginPage } from "../../src/client/pages/LoginPage";

describe("login submit feedback", () => {
  beforeEach(() => {
    loginMock.mockReset();
    loginMock.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("reports invalid and successful submissions with toasts", async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/login"]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/projects" element={<p>Projects collection</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    expect(screen.getByRole("heading", { level: 1, name: "Sign In" })).toBeInTheDocument();
    expect(screen.getByText("Internal Operations")).toBeInTheDocument();
    expect(screen.getByText("See The Cause, Not Just The Outage.")).toHaveClass("login-context__title");
    expect(screen.getByLabelText("Monitoring Coverage")).toBeInTheDocument();
    expect(screen.getByText("Resource Utilization")).toBeInTheDocument();
    expect(screen.getByText("Access is limited to authorized administrators.")).toBeInTheDocument();
    const rememberSession = screen.getByRole("checkbox", { name: /Remember My Session/i });
    expect(rememberSession).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    const notifications = screen.getByRole("region", { name: "Notifications" });
    expect(
      within(notifications).getByRole("alert")
    ).toHaveTextContent("Enter a valid email address and password.");
    fireEvent.click(within(notifications).getByRole("button", { name: "Dismiss Notification" }));
    expect(within(notifications).queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email Address"), {
      target: { value: "operator@example.com" }
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" }
    });
    fireEvent.click(rememberSession);
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith("operator@example.com", "secret", true)
    );
    expect(await screen.findByText("Projects collection")).toBeInTheDocument();
    expect(within(notifications).getByRole("status")).toHaveTextContent("Signed in.");
  });
});
