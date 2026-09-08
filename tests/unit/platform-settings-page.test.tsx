// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformTelegramSettings } from "../../src/shared/contracts";

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn()
}));

vi.mock("../../src/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/api")>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { PlatformSettingsPage } from "../../src/client/pages/PlatformSettingsPage";
import { ToastProvider } from "../../src/client/components/ToastProvider";

const settings: PlatformTelegramSettings = {
  telegram_bot_configured: false,
  telegram_chat_id: null
};

describe("platform Setting page", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation((_path, init) =>
      init?.method === "PATCH" ? Promise.resolve(undefined) : Promise.resolve(settings)
    );
  });

  afterEach(cleanup);

  it("saves one platform Telegram destination for all incidents", async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/settings"]}>
          <PlatformSettingsPage />
        </MemoryRouter>
      </ToastProvider>
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Telegram" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Telegram Alerts" })).toBeInTheDocument();
    const senderGroup = screen.getByRole("group", { name: "Platform Sender" });
    const destinationGroup = screen.getByRole("group", { name: "Alert Destination" });
    expect(within(senderGroup).queryByText("Not Configured")).not.toBeInTheDocument();
    expect(within(destinationGroup).queryByText("Not Configured")).not.toBeInTheDocument();
    const saveSenderButton = within(senderGroup).getByRole("button", { name: "Save Platform Sender" });
    const saveDestinationButton = within(destinationGroup).getByRole("button", { name: "Save Alert Destination" });
    expect(screen.getByLabelText("Telegram Bot Token").closest(".telegram-control-row")).toContainElement(saveSenderButton);
    expect(saveSenderButton).toBeDisabled();
    expect(saveDestinationButton).toBeDisabled();
    expect(saveSenderButton).not.toHaveAttribute("aria-describedby");
    expect(saveDestinationButton).not.toHaveAttribute("aria-describedby");
    const testMessageButton = within(destinationGroup).getByRole("button", { name: "Send Test Message" });
    const destinationControlRow = screen.getByLabelText("Telegram Chat ID").closest(".telegram-control-row");
    expect(destinationControlRow).toContainElement(saveDestinationButton);
    expect(destinationControlRow).toContainElement(testMessageButton);
    expect(testMessageButton).toBeDisabled();
    expect(within(destinationGroup).getByText("Disabled: Configure Platform Sender first.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Telegram Bot Token"), {
      target: { value: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcd" }
    });
    fireEvent.change(screen.getByLabelText("Telegram Chat ID"), {
      target: { value: "@ops_alerts" }
    });
    expect(saveSenderButton).toBeEnabled();
    expect(saveDestinationButton).toBeEnabled();
    expect(testMessageButton).toBeDisabled();
    expect(within(destinationGroup).getByText("Disabled: Save Platform Sender changes first.")).toBeInTheDocument();
    fireEvent.click(saveSenderButton);

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/settings/telegram", {
        method: "PATCH",
        body: JSON.stringify({
          telegram_bot_token: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcd",
          telegram_chat_id: null
        })
      })
    );
    expect(await screen.findByText("Platform sender saved.")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Notifications" })).getByRole("status")
    ).toHaveTextContent("Platform sender saved.");

    expect(testMessageButton).toBeDisabled();
    expect(within(destinationGroup).getByText("Disabled: Save Alert Destination changes first.")).toBeInTheDocument();
    fireEvent.click(saveDestinationButton);
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/settings/telegram", {
        method: "PATCH",
        body: JSON.stringify({ telegram_chat_id: "@ops_alerts" })
      })
    );
    expect(
      within(screen.getByRole("region", { name: "Notifications" })).getByRole("status")
    ).toHaveTextContent("Alert destination saved.");
    expect(within(senderGroup).queryByText("Configured")).not.toBeInTheDocument();
    expect(within(destinationGroup).queryByText("Configured")).not.toBeInTheDocument();

    await waitFor(() => expect(testMessageButton).toBeEnabled());
    expect(testMessageButton).not.toHaveAttribute("aria-describedby");
    fireEvent.click(testMessageButton);
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/settings/telegram/test", {
        method: "POST"
      })
    );
    expect(
      within(screen.getByRole("region", { name: "Notifications" })).getByRole("status")
    ).toHaveTextContent("Telegram test message sent.");
  });

  it("validates the destination on blur", async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/settings"]}>
          <PlatformSettingsPage />
        </MemoryRouter>
      </ToastProvider>
    );

    const input = await screen.findByLabelText("Telegram Chat ID");
    fireEvent.change(input, { target: { value: "invalid chat id" } });
    fireEvent.blur(input);

    expect(
      await screen.findByText("Use a numeric Chat ID or a channel username beginning with @.")
    ).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});
