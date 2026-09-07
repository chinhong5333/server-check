// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/client/api", async original => ({ ...await original<typeof import("../../src/client/api")>(), apiFetch: api }));
import { TelegramSettingsForm } from "../../src/client/components/TelegramSettingsForm";
import { ToastProvider } from "../../src/client/components/ToastProvider";
const discovery = { bot_username: "MonitorTestBot", chats: [{ id: "-1001234567890", name: "Operations Alerts", type: "supergroup" }] };
function renderForm(configured = true) { render(<ToastProvider><TelegramSettingsForm settings={{ telegram_bot_configured: configured, telegram_chat_id: null }} /></ToastProvider>); }
describe("Telegram chat picker", () => {
  beforeEach(() => { api.mockReset(); }); afterEach(cleanup);
  it("shows the direct first-message guide and fills the ID without saving", async () => {
    api.mockResolvedValue(discovery); renderForm();
    const trigger = screen.getByRole("button", { name: "Select Telegram Chat" }); fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Select Telegram Chat" });
    expect(await within(dialog).findByText("/start@MonitorTestBot")).toBeInTheDocument();
    expect(within(dialog).queryByText("Chat Missing?")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Select Operations Alerts, -1001234567890" }));
    expect(screen.getByLabelText("Telegram Chat ID")).toHaveValue("-1001234567890");
    expect(screen.getByRole("button", { name: "Save Alert Destination" })).toBeEnabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][0]).toBe("/api/v1/settings/telegram/chats");
  });
  it("can refresh an empty result and cancel without changing the field", async () => {
    api.mockResolvedValueOnce({ ...discovery, chats: [] }).mockResolvedValueOnce(discovery); renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Select Telegram Chat" }));
    expect(await screen.findByText(/No chats are available yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh List" }));
    await screen.findByText("Operations Alerts");
    fireEvent.click(screen.getByRole("button", { name: "Close Telegram Chat Selection" }));
    expect(screen.getByLabelText("Telegram Chat ID")).toHaveValue("");
  });
  it("shows a recoverable error while retaining the first-message guide", async () => {
    api.mockImplementation(async () => { throw new Error("Failed"); }); renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Select Telegram Chat" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The chat list could not be loaded");
    expect(screen.getByText("/start@YourBotUsername")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh List" })).toBeEnabled();
  });
  it("requires a saved sender and blocks detection while its token is being edited", () => {
    renderForm(false); expect(screen.getByRole("button", { name: "Select Telegram Chat" })).toBeDisabled();
    cleanup(); renderForm();
    fireEvent.change(screen.getByLabelText("Telegram Bot Token"), { target: { value: "unsaved" } });
    expect(screen.getByRole("button", { name: "Select Telegram Chat" })).toBeDisabled();
  });
});
