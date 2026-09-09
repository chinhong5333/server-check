import { Download, KeyRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_AGENT_CHECKS, generateAgentScriptBodySchema, type AgentChecks, type AgentInstallationResponse } from "../../shared/contracts";
import { apiFetch } from "../api";
import { AgentScriptChecks } from "./AgentScriptChecks";
import { CopyButton } from "./CopyButton";
import { ModalDialog } from "./ModalDialog";

export function RotateAgentSecretButton({ agentId, projectId, agentName, checks, healthApiUrl, onFinished }: {
  agentId: string; projectId: string; agentName: string; checks?: AgentChecks;
  healthApiUrl: string | null; onFinished: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftChecks, setDraftChecks] = useState<AgentChecks>({ ...DEFAULT_AGENT_CHECKS });
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installation, setInstallation] = useState<AgentInstallationResponse | null>(null);
  const [leaveStep, setLeaveStep] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!installation && !busy) return;
    if (installation) closeTrigger.current?.focus();
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [installation, busy]);

  function close() {
    if (busy) return;
    if (installation) setLeaveStep(1);
    else setOpen(false);
  }
  async function rotate() {
    if (busy || installation) return;
    const input = generateAgentScriptBodySchema.safeParse({ checks: draftChecks, health_api_url: draftChecks.middleware_api ? url : null });
    if (!input.success) { setError("Enter a valid Middleware API URL or disable its check."); return; }
    setBusy(true); setError(null);
    try {
      const result = await apiFetch<AgentInstallationResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/credential-rotation`,
        { method: "POST", body: JSON.stringify(input.data) });
      // Do not reload the parent here: the one-time script must stay mounted until explicitly closed.
      setInstallation(result);
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "Could not rotate the secret."} If the response was lost, retry rotation to obtain a new replacement script.`);
    } finally { setBusy(false); }
  }
  function download() {
    if (!installation) return;
    const objectUrl = URL.createObjectURL(new Blob([installation.script], { type: "text/x-shellscript" }));
    const link = document.createElement("a"); link.href = objectUrl; link.download = installation.script_filename; link.click();
    URL.revokeObjectURL(objectUrl);
  }
  return <>
    <button ref={trigger} className="button button--secondary" type="button" aria-haspopup="dialog" aria-controls="detail-rotate-secret"
      onClick={() => { setDraftChecks({ ...(checks ?? DEFAULT_AGENT_CHECKS) }); setUrl(healthApiUrl ?? ""); setError(null); setOpen(true); }}><KeyRound aria-hidden="true" />Rotate Secret</button>
    <ModalDialog id="detail-rotate-secret" open={open} labelledBy="detail-rotate-title" describedBy="detail-rotate-description"
      dialogClassName={installation ? "agent-dialog--agent-form" : undefined}
      surfaceClassName={installation ? "agent-dialog__surface form-surface" : "agent-dialog__surface agent-rotation-confirmation"} restoreFocusTo={trigger.current}>
      <div className={installation ? "section-heading" : undefined}>
        {!installation && <KeyRound aria-hidden="true" />}
        <div><h2 id="detail-rotate-title">{installation ? "Access Secret Rotated" : `Rotate Access Secret For ${agentName}?`}</h2>
          <p id="detail-rotate-description">{installation ? "The old secret is revoked. Save and install this replacement before closing; it cannot be retrieved again." : "Choose checks for the replacement script. Confirming immediately stops the old script from authenticating."}</p></div>
        <button ref={closeTrigger} className="icon-button" type="button" data-dialog-initial-focus aria-label="Close Secret Rotation" disabled={busy} onClick={close}><X aria-hidden="true" /></button>
      </div>
      {installation ? <div className="form-grid">
        <div className="field--wide rotation-result"><p>Replace the installed script, protect it with <code>chmod 700</code>, run it once, then replace its crontab entry.</p>
          <div className="action-row"><CopyButton value={installation.script} label="Copy Script" /><button className="button button--secondary" type="button" onClick={download}><Download aria-hidden="true" />Download Script</button></div>
          <h3>{installation.script_filename}</h3>
          <pre tabIndex={0} className="rotation-script-preview" aria-label="Replacement Agent Script"><code>{installation.script}</code></pre>
          <h3>Crontab Entry</h3><pre tabIndex={0} className="rotation-script-preview"><code>{installation.crontab_entry}</code></pre>
          <CopyButton value={installation.crontab_entry} label="Copy Crontab Entry" />
        </div>
      </div> : <>
        <AgentScriptChecks value={draftChecks} onChange={setDraftChecks} disabled={busy} />
        {draftChecks.middleware_api && <div className="field"><label htmlFor="detail-rotation-url">Middleware API URL</label>
          <input id="detail-rotation-url" type="url" value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} /></div>}
        {error && <p role="alert" className="field__help field__help--error">{error}</p>}
        <div className="action-row"><button className="button button--secondary" type="button" disabled={busy} onClick={close}>Cancel</button>
          <button className="button button--danger" type="button" disabled={busy} onClick={() => void rotate()}>{busy ? "Rotating Secret…" : "Rotate And Generate Script"}</button></div>
      </>}
    </ModalDialog>
    <ModalDialog id="detail-leave-secret" open={leaveStep > 0} labelledBy="detail-leave-title" describedBy="detail-leave-description"
      surfaceClassName="agent-dialog__surface form-surface" restoreFocusTo={closeTrigger.current}>
      <div className="section-heading"><div><h2 id="detail-leave-title">{leaveStep === 1 ? "Close Replacement Script?" : "Confirm Closing Script"}</h2>
        <p id="detail-leave-description">{leaveStep === 1 ? "Save the replacement script before continuing. It cannot be reopened after closing." : "Final confirmation: close this one-time script? You will need another rotation if it was not saved."}</p></div></div>
      <div className="form-grid"><button data-dialog-initial-focus className="button button--secondary" type="button" onClick={() => setLeaveStep(0)}>Keep Script Open</button>
        <button className="button button--danger" type="button" onClick={() => {
          if (leaveStep === 1) setLeaveStep(2);
          else { setLeaveStep(0); setInstallation(null); setOpen(false); onFinished(); }
        }}>{leaveStep === 1 ? "Continue" : "Close Script"}</button></div>
    </ModalDialog>
  </>;
}
