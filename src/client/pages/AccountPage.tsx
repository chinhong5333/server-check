import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { changePasswordBodySchema } from "../../shared/contracts";
import { ApiError, apiFetch } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { InlineLoader } from "../components/Feedback";
import { useToast } from "../components/ToastProvider";

export function AccountPage() {
  const { user, restore } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const input = changePasswordBodySchema.safeParse({ current_password: currentPassword, new_password: newPassword });
    if (!input.success || newPassword !== confirmation) {
      setError(newPassword !== confirmation ? "The new passwords do not match." : "Use a different password between 15 and 128 characters.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiFetch<void>("/api/v1/auth/password", { method: "POST", body: JSON.stringify(input.data) });
      setCurrentPassword(""); setNewPassword(""); setConfirmation("");
      await restore();
      showToast({ tone: "success", message: "Password changed. Sign in with your new password." });
      navigate("/login", { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The password could not be changed. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="settings-page-intro">
      <Link className="back-link" to="/projects"><ArrowLeft aria-hidden="true" /> Back To Projects</Link>
      <header className="page-header"><div><h1>Change Password</h1><p>{user?.email}</p></div></header>
      </div>
      <section className="form-surface account-password" aria-labelledby="change-password-title">
        <div className="section-heading"><div><h2 id="change-password-title">Change Password</h2>
          <p>Changing your password signs you out on every device.</p></div></div>
        <form className="form-grid" onSubmit={(event) => void submit(event)}>
          <div className="field field--wide"><label htmlFor="current-password">Current Password</label>
            <input id="current-password" type="password" autoComplete="current-password" required maxLength={1024}
              aria-describedby={error ? "password-change-error" : undefined}
              value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
          <div className="field"><label htmlFor="new-password">New Password</label>
            <input id="new-password" type="password" autoComplete="new-password" required minLength={15} maxLength={128}
              aria-describedby={error ? "new-password-help password-change-error" : "new-password-help"} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            <span className="field__help" id="new-password-help">Use 15–128 characters. Spaces and passphrases are supported.</span></div>
          <div className="field"><label htmlFor="confirm-password">Confirm New Password</label>
            <input id="confirm-password" type="password" autoComplete="new-password" required maxLength={128}
              aria-describedby={error ? "password-change-error" : undefined}
              value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>
          {error ? <p ref={errorRef} tabIndex={-1} id="password-change-error" className="field__help field__help--error field--wide" role="alert">{error}</p> : null}
          <div className="field--wide"><button className="button button--primary" disabled={pending} type="submit">
            {pending ? <InlineLoader label="Changing Password" /> : "Change Password"}</button></div>
        </form>
      </section>
    </div>
  );
}
