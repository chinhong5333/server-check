import { useCallback, useRef, useState, type FormEvent } from "react";
import { createAdminBodySchema } from "../../shared/contracts";
import { apiFetch } from "../api";
import { useApiResource } from "../hooks/useApiResource";
import { UserRound, UserPlus, X } from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { DateTimeStamp } from "./DateTimeStamp";
import { formatCount } from "../lib/format";

export function AdminManagement() {
  const load = useCallback(() => apiFetch<Array<{ id: string; email: string; created_at: number }>>("/api/v1/admins"), []);
  const admins = useApiResource("administrators", load);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  function close() {
    if (busy) return;
    setOpen(false); setEmail(""); setPassword(""); setConfirmation(""); setCurrentPassword(""); setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(""); setMessage("");
    const parsed = createAdminBodySchema.safeParse({ email, password, current_password: currentPassword });
    if (!parsed.success || password !== confirmation) {
      setError(password !== confirmation ? "The new admin passwords do not match." : "Enter a valid email, a 15–128 character password, and your current password."); return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/v1/admins", { method: "POST", body: JSON.stringify(parsed.data) });
      setEmail(""); setPassword(""); setConfirmation(""); setCurrentPassword("");
      setOpen(false);
      setMessage("The full-access admin account was created. Share its credentials through a secure channel.");
      admins.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the admin account."); }
    finally { setBusy(false); }
  }
  return <section className="form-surface admin-management" aria-labelledby="admin-management-title">
    <div className="section-heading teams-heading"><div><h2 id="admin-management-title">Team Members</h2>
      <p>Admins have full access to every project, platform setting, and admin account creation.</p></div>
      <div className="teams-actions">{admins.status === "success" && <span className="numeric section-count">Total {formatCount(admins.data?.length ?? 0)} {(admins.data?.length ?? 0) === 1 ? "Member" : "Members"}</span>}
        <button ref={trigger} className="button button--primary" type="button" aria-haspopup="dialog" aria-controls="add-admin-dialog"
          onClick={() => { setMessage(""); setError(""); setOpen(true); }}><UserPlus aria-hidden="true" />Add Admin</button>
      </div>
    </div>
    {message && <p role="status" className="quiet-message">{message}</p>}
    <div className="admin-list teams-list">
      {admins.status === "loading" && <p role="status">Loading Team Members…</p>}
      {admins.status === "error" && <div role="alert"><p>Could not load admins.</p><button className="button button--secondary" type="button" onClick={admins.reload}>Retry</button></div>}
      {admins.status === "success" && ((admins.data?.length ?? 0) === 0 ? <p className="quiet-message">No team members are available.</p> :
        <div className="table-wrap"><table className="data-table teams-table" aria-label="Team Members">
          <thead><tr><th scope="col">Email Address</th><th scope="col">Role</th><th scope="col">Joined</th></tr></thead>
          <tbody>{admins.data!.map((admin) => <tr key={admin.id}>
            <th scope="row" data-label="Email Address"><span className="team-member-identity"><span className="team-member-avatar"><UserRound aria-hidden="true" /></span><strong>{admin.email}</strong></span></th>
            <td data-label="Role"><span className="team-member-role">Full Access Admin</span></td>
            <td data-label="Joined">{admin.created_at ? <DateTimeStamp value={admin.created_at} /> : <span>--</span>}</td>
          </tr>)}</tbody>
        </table></div>)}
    </div>
    <ModalDialog id="add-admin-dialog" open={open} labelledBy="add-admin-title" describedBy="add-admin-description"
      restoreFocusTo={trigger.current} surfaceClassName="agent-dialog__surface form-surface admin-management">
      <div className="section-heading"><div><h2 id="add-admin-title">Add Admin</h2>
        <p id="add-admin-description">Create a full-access administrator. Confirm with your current password.</p></div>
        <button className="icon-button" type="button" aria-label="Close Admin Creation" disabled={busy} onClick={close}><X aria-hidden="true" /></button></div>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
      <div className="field field--wide"><label htmlFor="admin-email">Admin Email</label>
        <input data-dialog-initial-focus id="admin-email" type="email" autoComplete="off" maxLength={254} required disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field"><label htmlFor="admin-password">New Admin Password</label>
        <input id="admin-password" type="password" autoComplete="new-password" minLength={15} maxLength={128} required disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} />
        <span className="field__help">Use 15–128 characters. Share the password securely.</span></div>
      <div className="field"><label htmlFor="admin-confirm-password">Confirm Admin Password</label>
        <input id="admin-confirm-password" type="password" autoComplete="new-password" minLength={15} maxLength={128} required disabled={busy} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></div>
      <div className="field field--wide"><label htmlFor="admin-current-password">Your Current Password</label>
        <input id="admin-current-password" type="password" autoComplete="current-password" maxLength={1024} required disabled={busy} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        <span className="field__help">Confirm your identity before granting full admin access.</span></div>
      {error && <p role="alert" className="field--wide field__help--error">{error}</p>}
      <div className="field--wide teams-actions"><button className="button button--secondary" disabled={busy} type="button" onClick={close}>Cancel</button>
        <button className="button button--primary" disabled={busy} type="submit">{busy ? "Creating Admin…" : "Create Admin"}</button></div>
    </form>
    </ModalDialog>
  </section>;
}
