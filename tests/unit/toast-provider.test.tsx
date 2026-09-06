// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "../../src/client/components/ToastProvider";

function ToastHarness() {
  const { showToast } = useToast();
  return (
    <button
      type="button"
      onClick={() => showToast({ tone: "success", message: "Settings saved." })}
    >
      Show toast
    </button>
  );
}

describe("ToastProvider", () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("auto-dismisses after five seconds and pauses while hovered", () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
    const toast = screen.getByRole("status");
    fireEvent.mouseEnter(toast);

    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByRole("status")).toHaveTextContent("Settings saved.");

    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
