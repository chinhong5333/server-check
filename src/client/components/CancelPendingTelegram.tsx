import { useRef, useState } from "react";
import { apiFetch } from "../api";
import { HoldConfirmButton } from "./HoldConfirmButton";
import { ModalDialog } from "./ModalDialog";
import { t } from "../i18n";

export function CancelPendingTelegram({ agentId, agentName, onCancelled }: {
  agentId: string; agentName: string; onCancelled: () => void;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  async function cancelPending() {
    if (busy || step !== 2) return;
    setBusy(true); setError("");
    try {
      const result = await apiFetch<{ cancelled_count: number }>(`/api/v1/agents/${encodeURIComponent(agentId)}/telegram-deliveries/cancel-pending`,
        { method: "POST", body: JSON.stringify({ confirm: true }) });
      setMessage(t("{0} pending Telegram messages cancelled.", result.cancelled_count));
      setStep(0); onCancelled();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not cancel pending messages.")); }
    finally { setBusy(false); }
  }
  return <>
    <button ref={trigger} type="button" className="button button--secondary" aria-haspopup="dialog"
      onClick={() => { setStep(1); setError(""); setMessage(""); }}>{t("Clear Pending Messages")}</button>
    {message && <p role="status">{message}</p>}
    <ModalDialog id="cancel-pending-telegram" open={step > 0} labelledBy="cancel-pending-title"
      describedBy="cancel-pending-description" restoreFocusTo={trigger.current} surfaceClassName="agent-dialog__surface form-surface">
      <div className="section-heading"><h2 id="cancel-pending-title">{step === 1 ? t("Clear Pending Telegram Messages") : t("Confirm Cancellation")}</h2></div>
      <div className="form-grid">
        <p id="cancel-pending-description" className="field--wide">{step === 1
          ? t("Cancel all queued Telegram messages for {0}? Their delivery logs will remain. Other agents and future alerts are unaffected.", agentName)
          : t("Please confirm again: all pending Telegram messages for {0} will stop retrying. A message already being sent may still arrive. This cannot be undone.", agentName)}</p>
        {error && <p role="alert" className="field--wide field__help--error">{error}</p>}
        <button data-dialog-initial-focus type="button" className="button button--secondary" disabled={busy} onClick={() => setStep(0)}>{t("Keep Messages")}</button>
        {step === 1 ? <button type="button" className="button button--danger" onClick={() => setStep(2)}>{t("Continue")}</button>
          : <HoldConfirmButton label={t("Confirm Clear Pending")} busy={busy} busyLabel={t("Cancelling Messages")} onConfirm={() => void cancelPending()} />}
      </div>
    </ModalDialog>
  </>;
}
