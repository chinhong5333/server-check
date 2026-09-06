// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "../../src/client/components/ThemeToggle";
import { THEME_STORAGE_KEY } from "../../src/client/lib/theme";

describe("Theme preference", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn()
    })));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("follows the system initially and remembers a manual choice across mounts", () => {
    const first = render(<ThemeToggle />);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    const darkMode = screen.getByRole("button", { name: "Dark Mode: Switch To Light Mode" });
    expect(darkMode).toHaveAttribute("title", "Dark To Light");
    fireEvent.click(darkMode);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    first.unmount();
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Light Mode: Switch To Dark Mode" })).toHaveAttribute("title", "Light To Dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("still toggles when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Dark Mode: Switch To Light Mode" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
