// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SidebarClock } from "../../src/client/components/SidebarClock";
afterEach(()=>{cleanup();vi.useRealTimers();});
it("ticks each second, rolls over midnight, and clears its timer",()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,8,9,23,59,59));
  const view=render(<SidebarClock />);
  expect(screen.getByText("23:59:59")).toHaveAttribute("aria-live","off");
  act(()=>vi.advanceTimersByTime(1000));expect(screen.getByText("00:00:00")).toBeInTheDocument();
  view.unmount();expect(vi.getTimerCount()).toBe(0);
});
it("resynchronizes immediately when the browser regains focus",()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,8,9,1,2,3));render(<SidebarClock />);
  vi.setSystemTime(new Date(2026,8,9,13,5,6));fireEvent.focus(window);
  expect(screen.getByText("13:05:06")).toBeInTheDocument();
});
