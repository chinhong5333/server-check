// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  apiFetch: api
}));
import { ApiError } from "../../src/client/api";
import { AuthProvider, useAuth } from "../../src/client/auth/AuthProvider";

const session = { user: { id: "user-1", email: "synthetic@example.test", role: "admin", permissions: [] }, csrf_token: "synthetic" };

function Probe() {
  return <p>{useAuth().status}</p>;
}

async function signedIn() {
  api.mockResolvedValueOnce(session);
  render(<AuthProvider><Probe /></AuthProvider>);
  await act(async () => Promise.resolve());
  expect(screen.getByText("authenticated")).toBeInTheDocument();
}

async function returnToPage() {
  await act(async () => { window.dispatchEvent(new Event("focus")); });
}

beforeEach(() => api.mockReset());
afterEach(cleanup);

it("keeps the session when the check on returning to the page fails without a server answer", async () => {
  await signedIn();
  api.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await returnToPage();
  expect(screen.getByText("authenticated")).toBeInTheDocument();
  api.mockRejectedValueOnce(new ApiError(502, "request_failed", "Bad gateway"));
  await returnToPage();
  expect(screen.getByText("authenticated")).toBeInTheDocument();
});

it("ends the session when the server rejects it", async () => {
  await signedIn();
  api.mockRejectedValueOnce(new ApiError(401, "invalid_session", "Your session is invalid or expired. Sign in again."));
  await returnToPage();
  expect(screen.getByText("anonymous")).toBeInTheDocument();
});
