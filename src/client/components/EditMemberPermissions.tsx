import { useRef, useState, type FormEvent } from "react";
import { Settings, X } from "lucide-react";
import { apiFetch } from "../api";
import { ModalDialog } from "./ModalDialog";
import { PermissionChecklist } from "./PermissionChecklist";
import { permissionsSchema, type Permission } from "../../shared/permissions";

export function EditMemberPermissions({ member, onSaved }: {
  member: { id: string; email: string; permissions: Permission[] }; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [permissions, setPermissions] = useState(member.permissions), [password, setPassword] = useState("");
  const [error, setError] = useState(""); const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { if (!busy) { setOpen(false); setPassword(""); setError(""); } };
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (!permissionsSchema.safeParse(permissions).success || !password) { setError("Check the permissions and enter your current password."); return; }
    setBusy(true); setError("");
    try {
      await apiFetch(`/api/v1/admins/${encodeURIComponent(member.id)}/permissions`, {method:"PATCH",body:JSON.stringify({ permissions, current_password:password })});
      setOpen(false); setPassword(""); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update permissions."); }
    finally { setBusy(false); }
  }
  return <>
    <button ref={trigger} className="button button--secondary" type="button" aria-haspopup="dialog" onClick={() => { setPermissions(member.permissions); setOpen(true); }}><Settings aria-hidden="true" />Edit Permissions</button>
    <ModalDialog id={`permissions-${member.id}`} open={open} labelledBy={`permissions-title-${member.id}`} restoreFocusTo={trigger.current} surfaceClassName="agent-dialog__surface form-surface team-dialog">
      <div className="section-heading"><div><h2 id={`permissions-title-${member.id}`}>Edit Permissions</h2><p>{member.email}</p></div>
        <button type="button" className="icon-button" aria-label="Close Permissions" disabled={busy} onClick={close}><X aria-hidden="true" /></button></div>
      <form className="form-grid" onSubmit={submit}>
        <PermissionChecklist value={permissions} onChange={setPermissions} disabled={busy} />
        <label className="field field--wide">Your Current Password<input data-dialog-initial-focus type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
        {error && <p role="alert" className="field--wide field__help--error">{error}</p>}
        <button type="submit" className="button button--primary field--wide" disabled={busy}>{busy ? "Saving Permissions…" : "Save Permissions"}</button>
      </form>
    </ModalDialog>
  </>;
}
