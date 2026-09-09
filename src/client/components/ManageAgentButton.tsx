import { Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentEditableInput, AgentSummary } from "../../shared/contracts";
import { apiFetch } from "../api";
import { AgentForm } from "./AgentForm";
import { ModalDialog } from "./ModalDialog";
import { ErrorState, PageSkeleton } from "./Feedback";

export function ManageAgentButton({ agentId, projectId, agentName, onSaved }: {
  agentId: string; projectId: string; agentName: string; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AgentSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/agents`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setSettings(null); setError(null);
    void apiFetch<AgentSummary[]>(base, { signal: controller.signal }).then((agents) => {
      if (controller.signal.aborted) return;
      const found = agents.find((agent) => agent.id === agentId);
      if (!found) throw new Error("The agent is no longer available.");
      setSettings(found);
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load agent settings.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, base, agentId, version]);

  async function save(values: AgentEditableInput) {
    if (saving || !settings) return;
    setSaving(true); setError(null);
    try {
      await apiFetch<void>(`${base}/${encodeURIComponent(agentId)}`, { method: "PUT", body: JSON.stringify(values) });
      setOpen(false); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save agent settings."); }
    finally { setSaving(false); }
  }
  return <>
    <button ref={trigger} className="button button--secondary" type="button" aria-haspopup="dialog"
      aria-controls="manage-agent-dialog" onClick={() => { setSettings(null); setError(null); setLoading(true); setOpen(true); }}><Settings aria-hidden="true" />Manage</button>
    <ModalDialog id="manage-agent-dialog" open={open} labelledBy="manage-agent-title" dialogClassName="agent-dialog--agent-form"
      surfaceClassName="agent-dialog__surface form-surface" restoreFocusTo={trigger.current}>
      <div className="section-heading"><h2 id="manage-agent-title">Manage {agentName}</h2>
        <button data-dialog-initial-focus className="icon-button" type="button" aria-label="Close Agent Settings" disabled={saving} onClick={() => setOpen(false)}><X aria-hidden="true" /></button></div>
      {loading ? <PageSkeleton rows={3} /> : settings ? <AgentForm key={settings.id} initialValues={settings}
        submitting={saving} submitLabel="Save Changes" submittingLabel="Saving Changes" error={error} onSubmit={(values) => void save(values)} />
        : error ? <ErrorState title="Couldn't Load Agent Settings" message={error} onRetry={() => setVersion((value) => value + 1)} /> : null}
    </ModalDialog>
  </>;
}
