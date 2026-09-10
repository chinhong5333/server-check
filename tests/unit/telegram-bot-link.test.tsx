// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../src/client/api", () => ({ apiFetch: fetchMock }));
import { TelegramBotLink } from "../../src/client/components/TelegramBotLink";
beforeEach(() => { fetchMock.mockReset(); });
afterEach(cleanup);
it("loads and displays the safe public bot link in a new tab", async () => {
  fetchMock.mockResolvedValue({ username: "MonitorTestBot", url: "https://t.me/MonitorTestBot" });
  render(<TelegramBotLink />);
  const link = await screen.findByRole("link", { name: "Open Telegram Bot @MonitorTestBot In A New Tab" });
  expect(link).toHaveAttribute("href", "https://t.me/MonitorTestBot");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
});
it("allows retry after an error and never renders arbitrary upstream links", async () => {
  fetchMock.mockResolvedValueOnce({ username: "MonitorTestBot", url: "javascript:bad" })
    .mockResolvedValueOnce({ username: "MonitorTestBot", url: "https://t.me/MonitorTestBot" });
  render(<TelegramBotLink />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry Bot Link" }));
  expect(await screen.findByRole("link")).toHaveAttribute("href", "https://t.me/MonitorTestBot");
});
it("aborts the lookup on unmount", () => {
  fetchMock.mockReturnValue(new Promise(() => {}));
  const view = render(<TelegramBotLink />);
  const signal = fetchMock.mock.calls[0][1].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});
