// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageToggle } from "../../src/client/components/LanguageToggle";
import { StatusBadge } from "../../src/client/components/StatusBadge";
import { chooseLocale, LOCALE_STORAGE_KEY, t, useLocale } from "../../src/client/i18n";
import { formatCount } from "../../src/client/lib/format";

function Page() {
  useLocale();
  return <main>
    <LanguageToggle />
    <input aria-label="Draft" />
    <h1>{t("Delete Agent")}</h1>
    <StatusBadge status="healthy" />
    <output>{formatCount(1500)}</output>
  </main>;
}

afterEach(() => {
  cleanup();
  chooseLocale("en");
  vi.restoreAllMocks();
});

it("switches the whole page in place and remembers the choice", () => {
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  render(<Page />);
  const draft = screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" });
  fireEvent.change(draft, { target: { value: "unsaved text" } });
  expect(screen.getByRole("heading")).toHaveTextContent("Delete Agent");
  expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("1.5K");

  fireEvent.click(screen.getByRole("button", { name: "Switch Language To 简体中文" }));

  expect(screen.getByRole("heading")).toHaveTextContent("删除探针");
  expect(screen.getByText("健康")).toBeInTheDocument();
  expect(screen.getByRole("status", { hidden: true })).not.toHaveTextContent("1.5K");
  expect(document.documentElement.lang).toBe("zh-CN");
  expect(setItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, "zh-CN");
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect(draft).toHaveValue("unsaved text");
});

it("switches back to English", () => {
  chooseLocale("zh-CN");
  render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "切换语言为 English" }));
  expect(screen.getByRole("heading")).toHaveTextContent("Delete Agent");
  expect(screen.getByText("Healthy")).toBeInTheDocument();
  expect(document.documentElement.lang).toBe("en");
});

it("still switches when the choice cannot be saved", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "Switch Language To 简体中文" }));
  expect(screen.getByRole("heading")).toHaveTextContent("删除探针");
});
