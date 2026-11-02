// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const { chooseLocale, current } = vi.hoisted(() => ({ chooseLocale: vi.fn(), current: { locale: "en" } }));
vi.mock("../../src/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/i18n")>()),
  chooseLocale,
  get locale() { return current.locale; }
}));
import { LanguageToggle } from "../../src/client/components/LanguageToggle";

afterEach(() => { cleanup(); chooseLocale.mockReset(); });

it.each([
  ["en", "Switch Language To 简体中文", "中文", "zh-CN"],
  ["zh-CN", "Switch Language To English", "EN", "en"]
])("from %s offers one button naming the other language", (locale, name, visible, target) => {
  current.locale = locale;
  render(<LanguageToggle />);
  const button = screen.getByRole("button", { name });
  expect(button).toHaveTextContent(visible);
  fireEvent.click(button);
  expect(chooseLocale).toHaveBeenCalledExactlyOnceWith(target);
});
