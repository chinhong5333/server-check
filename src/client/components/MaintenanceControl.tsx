import { CalendarClock, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { createMaintenanceBodySchema, type MaintenanceState } from "../../shared/contracts";
import { apiFetch } from "../api";
import { useApiResource, FAST_REFRESH_INTERVAL_MS } from "../hooks/useApiResource";
import { formatDateTime } from "../lib/format";
import { InlineLoader } from "./Feedback";
import { ModalDialog } from "./ModalDialog";

function localDateTime(at: number): string {
  const date = new Date(at);
  return new Date(at - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Compact scoped controls; viewers can inspect windows but cannot mutate them. */
export function MaintenanceControl({ endpoint, scope, canManage, onChanged, onActiveChange, detailsTargetId }: {
  endpoint: string; scope: "Project" | "Agent"; canManage: boolean;
  onChanged?: () => void; onActiveChange?: (active: boolean) => void;
  /** Renders the trigger here and window details in the named sibling slot. */
  detailsTargetId?: string;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null);
  const load = useCallback(() => apiFetch<MaintenanceState>(endpoint), [endpoint]);
  const resource = useApiResource(`maintenance:${endpoint}`, load, { refreshIntervalMs: FAST_REFRESH_INTERVAL_MS });
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("now"), [start, setStart] = useState(""), [end, setEnd] = useState("");
  const [reason, setReason] = useState(""), [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [detailsTarget, setDetailsTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setDetailsTarget(detailsTargetId ? document.getElementById(detailsTargetId) : null); }, [detailsTargetId]);
  const state = resource.data;
  const windows = [state?.inherited, state?.own].filter(window => window != null);
  const active = windows.some(window => window.status === "active");
  useEffect(() => { if (state) onActiveChange?.(active); }, [state, active, onActiveChange]);
  const close = () => { if (!busy) { setOpen(false); setError(""); setFieldErrors({}); } };
  function showSchedule() {
    setMode("now"); setStart(localDateTime(Date.now() + 5 * 60000)); setEnd(localDateTime(Date.now() + 3600000));
    setReason(""); setError(""); setFieldErrors({}); setOpen(true);
  }
  function validateFields() {
    const startsAt = mode === "now" ? null : new Date(start).getTime(), endsAt = new Date(end).getTime();
    const errors: Record<string, string> = {};
    if (mode !== "now" && (!Number.isFinite(startsAt) || startsAt! < Date.now() - 5000 || startsAt! > Date.now() + 90 * 86400000)) errors.start = "Choose a future start within 90 days.";
    if (!Number.isFinite(endsAt) || endsAt <= Math.max(Date.now(), startsAt ?? Date.now()) || endsAt - (startsAt ?? Date.now()) > 30 * 86400000) errors.end = "Choose an end after the start, within 30 days.";
    if (reason.trim().length < 3 || reason.trim().length > 500) errors.reason = "Use a reason with 3–500 characters.";
    return errors;
  }
  function validateField(field: string) { setFieldErrors(previous => ({ ...previous, [field]: validateFields()[field] ?? "" })); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const startsAt = mode === "now" ? null : new Date(start).getTime(), endsAt = new Date(end).getTime();
    const errors = validateFields();
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      const first = errors.start ? "start" : errors.end ? "end" : "reason";
      document.getElementById(`${id}-${first}`)?.focus(); return;
    }
    const body = createMaintenanceBodySchema.parse({ starts_at: startsAt, ends_at: endsAt, reason });
    setBusy(true); setError("");
    try {
      await apiFetch(endpoint, { method: "POST", body: JSON.stringify(body) });
      setOpen(false); resource.reload(); onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save maintenance. Try again."); }
    finally { setBusy(false); }
  }
  async function endWindow() {
    if (!state?.own || busy) return;
    setBusy(true); setError("");
    try {
      await apiFetch(`${endpoint}/${encodeURIComponent(state.own.id)}`, { method: "DELETE" });
      resource.reload(); onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not end maintenance. Try again."); }
    finally { setBusy(false); }
  }
  if (!canManage && !windows.length && resource.status !== "error") return null;
  const scheduleAction = canManage && !state?.own ? <button ref={trigger} type="button" className="button button--secondary" disabled={!state || busy}
    aria-haspopup="dialog" aria-controls={`${id}-dialog`} onClick={showSchedule}><CalendarClock aria-hidden="true" />Schedule Maintenance</button> : null;
  const panel = !detailsTargetId || windows.length > 0 ? <section className={`maintenance-control${active ? " maintenance-control--active" : ""}`} aria-label={`${scope} Maintenance`}>
    <div className="maintenance-control__heading">
      <span><Wrench aria-hidden="true" /><strong>{scope} Maintenance</strong></span>
      {resource.status === "loading" ? <span role="status"><InlineLoader label="Loading Maintenance" /></span> : null}
      {!detailsTargetId ? scheduleAction : null}
      {canManage && state?.own ? <button type="button" className="button button--secondary" disabled={busy} onClick={() => void endWindow()}>
        {busy ? <InlineLoader label="Saving Maintenance" /> : state.own.status === "active" ? "End Maintenance Now" : "Cancel Maintenance"}</button> : null}
    </div>
    {windows.map(window => <div className="maintenance-window" key={window.id}>
      <span className={`status status--${window.status === "active" ? "warning" : "new"}`}>{window.scope === "project" && scope === "Agent" ? "Project " : ""}{window.status === "active" ? "Maintenance Active" : "Maintenance Scheduled"}</span>
      <div><strong>{window.reason}</strong><p>{window.status === "scheduled" ? `Starts ${formatDateTime(window.starts_at)} · ` : ""}Until {formatDateTime(window.ends_at)}</p></div>
    </div>)}
    {state && !windows.length ? <p className="field__help">Monitoring continues. Telegram is muted only during an active window.</p> : null}
    {active ? <p className="field__help">Telegram is muted. Incidents and metrics continue recording; old messages will not be replayed.</p> : null}
    {resource.error ? <div className="maintenance-control__error" role="alert"><p>Could not load maintenance. Try again.</p><button className="button button--secondary" type="button" onClick={resource.reload}>Retry</button></div> : null}
    {!open && error ? <p className="field__help field__help--error" role="alert">{error}</p> : null}
  </section> : null;
  return <>
    {detailsTargetId ? <>{scheduleAction}{resource.error && !windows.length && canManage ? <button type="button" className="button button--secondary" onClick={resource.reload}>Retry Maintenance</button> : null}</> : null}
    {detailsTargetId ? detailsTarget && panel ? createPortal(panel, detailsTarget) : null : panel}
    <ModalDialog id={`${id}-dialog`} open={open} labelledBy={`${id}-title`} restoreFocusTo={trigger.current}
      onDismiss={close} dialogClassName="agent-dialog--maintenance" surfaceClassName="agent-dialog__surface form-surface">
      <div className="section-heading"><div><h2 id={`${id}-title`}>Schedule {scope} Maintenance</h2><p>Mute Telegram without stopping monitoring.</p></div>
        <button className="icon-button" type="button" aria-label="Close Maintenance" disabled={busy} onClick={close}><X aria-hidden="true" /></button></div>
      <form className="form-grid maintenance-form" onSubmit={event => void submit(event)} noValidate aria-busy={busy}>
        <label className="field">Start<select data-dialog-initial-focus value={mode} disabled={busy} onChange={event => setMode(event.target.value)}><option value="now">Start Now</option><option value="scheduled">Scheduled Start</option></select></label>
        <div className="maintenance-time-fields">
          {mode === "scheduled" ? <div className="field"><label htmlFor={`${id}-start`}>Start Time</label><input id={`${id}-start`} type="datetime-local" required value={start} disabled={busy} onChange={event => setStart(event.target.value)} onBlur={() => validateField("start")} aria-invalid={fieldErrors.start ? "true" : undefined} aria-describedby={`${id}-start-help`} />
            <span id={`${id}-start-help`} className={`field__help${fieldErrors.start ? " field__help--error" : ""}`}>{fieldErrors.start ?? "Scheduled within the next 90 days."}</span></div> : null}
          <div className="field"><label htmlFor={`${id}-end`}>End Time</label><input id={`${id}-end`} type="datetime-local" required value={end} disabled={busy} onChange={event => setEnd(event.target.value)} onBlur={() => validateField("end")} aria-invalid={fieldErrors.end ? "true" : undefined} aria-describedby={`${id}-end-help`} />
            <span id={`${id}-end-help`} className={`field__help${fieldErrors.end ? " field__help--error" : ""}`}>{fieldErrors.end ?? `Times use ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Maximum 30 days.`}</span></div>
        </div>
        <div className="field"><label htmlFor={`${id}-reason`}>Reason</label><input id={`${id}-reason`} value={reason} disabled={busy} required maxLength={500} autoComplete="off" onChange={event => setReason(event.target.value)} onBlur={() => validateField("reason")} aria-invalid={fieldErrors.reason ? "true" : undefined} aria-describedby={`${id}-reason-help`} placeholder="Scheduled server update" />
          <span id={`${id}-reason-help`} className={`field__help${fieldErrors.reason ? " field__help--error" : ""}`}>{fieldErrors.reason ?? "Visible to team members and recorded in the audit log."}</span></div>
        {error ? <p className="field__help field__help--error" role="alert">{error}</p> : null}
        <div className="action-row"><button className="button button--secondary" type="button" disabled={busy} onClick={close}>Cancel</button><button className="button button--primary" type="submit" disabled={busy}>{busy ? <InlineLoader label="Saving Maintenance" /> : "Save Maintenance"}</button></div>
      </form>
    </ModalDialog>
  </>;
}
