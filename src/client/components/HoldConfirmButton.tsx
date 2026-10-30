import { Lock } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { InlineLoader } from "./Feedback";

export const HOLD_CONFIRM_SECONDS = 2;
export const HOLD_CONFIRM_LOCK_SECONDS = 3;

/**
 * Confirm button for destructive or irreversible actions. It stays locked for `lockSeconds` after it appears,
 * then fires `onConfirm` only after a continuous press-and-hold (pointer, Space or Enter) of HOLD_CONFIRM_SECONDS.
 * The visible label never changes, so the accessible name stays stable; the lock stays focusable via aria-disabled.
 */
export function HoldConfirmButton({ label, onConfirm, tone = "danger", lockSeconds = HOLD_CONFIRM_LOCK_SECONDS, busy = false, busyLabel,
  disabled = false, icon, description = `Press and hold for ${HOLD_CONFIRM_SECONDS} seconds to confirm.`, ref }: {
  label: string; onConfirm: () => void; tone?: "danger" | "primary"; lockSeconds?: number;
  busy?: boolean; busyLabel?: string; disabled?: boolean; icon?: ReactNode; description?: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  const [locked, setLocked] = useState(lockSeconds);
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const hintId = useId();
  const clear = () => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = null; };
  useEffect(() => clear, []);
  useEffect(() => {
    if (locked <= 0) return;
    const tick = window.setTimeout(() => setLocked((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(tick);
  }, [locked]);
  const inactive = busy || disabled || locked > 0;
  function start() {
    if (inactive || timer.current !== null) return;
    setHolding(true);
    timer.current = window.setTimeout(() => { clear(); setHolding(false); onConfirm(); }, HOLD_CONFIRM_SECONDS * 1000);
  }
  function cancel() { clear(); setHolding(false); }
  const isActivationKey = (key: string) => key === " " || key === "Enter";
  return <>
    <button ref={ref} type="button" className={`button button--${tone} hold-button${holding ? " hold-button--holding" : ""}`}
      disabled={busy || disabled} aria-disabled={locked > 0 || undefined} aria-describedby={hintId}
      style={{ "--hold-duration": `${HOLD_CONFIRM_SECONDS}s` } as CSSProperties}
      onPointerDown={(event) => { if (event.button === 0) start(); }} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
      onKeyDown={(event) => { if (isActivationKey(event.key)) { event.preventDefault(); if (!event.repeat) start(); } }}
      onKeyUp={(event) => { if (isActivationKey(event.key)) cancel(); }} onBlur={cancel} onContextMenu={(event) => event.preventDefault()}>
      <span className="hold-button__fill" aria-hidden="true" />
      {busy && busyLabel ? <InlineLoader label={busyLabel} /> : <>
        {icon}{holding ? "Keep Holding…" : label}
        {holding ? null : <span className="hold-button__hint" aria-hidden="true">{locked > 0 ? <><Lock />{locked}s</> : "Hold"}</span>}
      </>}
    </button>
    <span id={hintId} className="visually-hidden">{locked > 0 ? `Available in ${locked} ${locked === 1 ? "second" : "seconds"}. ` : ""}{description}</span>
  </>;
}
