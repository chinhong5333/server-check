import { Activity, Eye, EyeOff, Gauge, HeartPulse, History, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { InlineLoader } from "../components/Feedback";
import { useToast } from "../components/ToastProvider";
import { ThemeToggle } from "../components/ThemeToggle";

export function LoginPage() {
  const { status, login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberSession, setRememberSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState({ email: false, password: false });

  if (status === "authenticated") return <Navigate to="/projects" replace />;

  const emailError = touched.email && !/^\S+@\S+\.\S+$/.test(email) ? "Enter a valid email address." : null;
  const passwordError = touched.password && password.length === 0 ? "Enter your password." : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched({ email: true, password: true });
    if (!/^\S+@\S+\.\S+$/.test(email) || !password) {
      showToast({ tone: "error", message: "Enter a valid email address and password." });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password, rememberSession);
      showToast({ tone: "success", message: "Signed in." });
      navigate("/projects", { replace: true });
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : "Sign-in failed. Check the central service and try again.";
      setError(message);
      showToast({ tone: "error", message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-theme-toggle"><ThemeToggle /></div>
      <div className="login-shell">
        <section className="login-context" aria-labelledby="login-context-title">
          <div className="wordmark login-wordmark">
            <ShieldCheck aria-hidden="true" />
            <span>
              Server Check
              <small>Internal Operations</small>
            </span>
          </div>

          <div className="login-context__intro">
            <p className="login-context__title" id="login-context-title">See The Cause, Not Just The Outage.</p>
            <p>Track agent heartbeat, resource utilization, health responses, and seven-day incident history from one operational view.</p>
          </div>

          <dl className="login-capabilities" aria-label="Monitoring Coverage">
            <div>
              <HeartPulse aria-hidden="true" />
              <span><dt>Heartbeat</dt><dd>Detect missed agent reports.</dd></span>
            </div>
            <div>
              <Gauge aria-hidden="true" />
              <span><dt>Resource Utilization</dt><dd>Review RAM, storage, and CPU load.</dd></span>
            </div>
            <div>
              <Activity aria-hidden="true" />
              <span><dt>Health Response</dt><dd>Inspect HTTP status and latency.</dd></span>
            </div>
            <div>
              <History aria-hidden="true" />
              <span><dt>Seven-Day History</dt><dd>Trace recent metrics and incidents.</dd></span>
            </div>
          </dl>
        </section>

        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-panel__content">
            <div className="login-panel__heading">
              <h1 id="login-title">Sign In</h1>
              <p>Continue to the operations workspace with your internal administrator account.</p>
            </div>
            {error ? <div className="form-banner form-banner--error" role="alert">{error}</div> : null}
            <form onSubmit={submit} noValidate aria-busy={submitting}>
              <div className="field">
                <label htmlFor="email">Email Address</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onBlur={() => setTouched((value) => ({ ...value, email: true }))}
                  aria-invalid={emailError ? "true" : undefined}
                  aria-describedby="email-help"
                  placeholder="operator@example.com"
                  autoFocus
                />
                <span className={`field__help${emailError ? " field__help--error" : ""}`} id="email-help">
                  {emailError ?? "Your internal account email."}
                </span>
              </div>

              <div className="field">
                <label htmlFor="password">Password</label>
                <div className="input-with-action">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    spellCheck={false}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onBlur={() => setTouched((value) => ({ ...value, password: true }))}
                    aria-invalid={passwordError ? "true" : undefined}
                    aria-describedby="password-help"
                  />
                  <button
                    className="input-action"
                    type="button"
                    aria-label={showPassword ? "Hide Password" : "Show Password"}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </div>
                <span
                  className={`field__help${passwordError ? " field__help--error" : ""}`}
                  id="password-help"
                >
                  {passwordError ?? "Password managers and paste are supported."}
                </span>
              </div>

              <label className="remember-session" htmlFor="remember-session">
                <input
                  id="remember-session"
                  type="checkbox"
                  checked={rememberSession}
                  onChange={(event) => setRememberSession(event.target.checked)}
                />
                <span>
                  <strong>Remember My Session</strong>
                  <small>Keep this browser signed in for 7 days.</small>
                </span>
              </label>

              <button className="button button--primary button--full" type="submit" disabled={submitting}>
                {submitting ? <InlineLoader label="Signing In" /> : "Sign In"}
              </button>
            </form>

            <p className="login-panel__security">
              <ShieldCheck aria-hidden="true" />
              Access is limited to authorized administrators.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
