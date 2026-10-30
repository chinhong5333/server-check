import { act, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { HOLD_CONFIRM_LOCK_SECONDS, HOLD_CONFIRM_SECONDS } from "../../../src/client/components/HoldConfirmButton";

/** Waits out a HoldConfirmButton's lock one second per render, then holds it until it confirms. Needs vi fake timers. */
export function holdToConfirm(button: HTMLElement): void {
  for (let second = 0; second < HOLD_CONFIRM_LOCK_SECONDS; second += 1) act(() => { vi.advanceTimersByTime(1000); });
  fireEvent.pointerDown(button, { button: 0 });
  act(() => { vi.advanceTimersByTime(HOLD_CONFIRM_SECONDS * 1000); });
}
