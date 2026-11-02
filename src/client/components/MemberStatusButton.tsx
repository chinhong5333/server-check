import { Power, X } from "lucide-react";
import { useRef, useState } from "react";
import { apiFetch } from "../api";
import { ModalDialog } from "./ModalDialog";
import { t } from "../i18n";

export function MemberStatusButton({ member, onSaved }: {
  member: { id: string; email: string; enabled: boolean }; onSaved: () => void;
}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const trigger=useRef<HTMLButtonElement>(null);
  const action=member.enabled ? t("Disable") : t("Enable");
  const close=()=>{if(!busy){setOpen(false);setError("");}};
  async function confirm() {
    if(busy)return;setBusy(true);setError("");
    try {
      await apiFetch(`/api/v1/admins/${encodeURIComponent(member.id)}/status`,{method:"PATCH",body:JSON.stringify({enabled:!member.enabled})});
      setOpen(false);onSaved();
    } catch(cause){setError(cause instanceof Error?cause.message:t("Could not change account status."));}
    finally{setBusy(false);}
  }
  return <>
    <button ref={trigger} type="button" className="button button--secondary" aria-label={`${action} ${member.email}`} aria-haspopup="dialog" onClick={()=>setOpen(true)}><Power aria-hidden="true" />{action}</button>
    <ModalDialog id={`member-status-${member.id}`} open={open} labelledBy={`member-status-title-${member.id}`} restoreFocusTo={trigger.current} surfaceClassName="agent-dialog__surface form-surface">
      <div className="section-heading"><div><h2 id={`member-status-title-${member.id}`}>{t("{0} Sub-Admin", action)}</h2><p>{member.email}</p></div>
        <button data-dialog-initial-focus type="button" className="icon-button" aria-label={t("Close Account Status")} disabled={busy} onClick={close}><X aria-hidden="true" /></button></div>
      <div className="form-grid">
        <p className="field--wide">{member.enabled ? t("This blocks sign-in and revokes all existing sessions. Their permissions and data will be preserved.") : t("This restores sign-in with the existing password and permissions. They must sign in again.")}</p>
        {error&&<p role="alert" className="field--wide field__help--error">{error}</p>}
        <div className="teams-actions field--wide"><button type="button" className="button button--secondary" disabled={busy} onClick={close}>{t("Cancel")}</button>
          <button type="button" className="button button--primary" disabled={busy} onClick={()=>void confirm()}>{busy?t("Saving…"):t("{0} Sub-Admin", action)}</button></div>
      </div>
    </ModalDialog>
  </>;
}
