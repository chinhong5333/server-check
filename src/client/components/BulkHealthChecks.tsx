import { ListChecks, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_AGENT_CHECKS, type AgentChecks, type AgentSummary, type BulkAgentChecksResult } from "../../shared/contracts";
import { apiFetch, ApiError } from "../api";
import { InlineLoader } from "./Feedback";
import { ModalDialog } from "./ModalDialog";
import { useToast } from "./ToastProvider";
import { t } from "../i18n";

type CheckKey = keyof AgentChecks;
/** Column key, short header label, full name for accessible labels. */
const columns = (): [CheckKey, string, string][] => [["apache", t("Apache"), t("Apache")], ["nginx", t("Nginx"), t("Nginx")], ["middleware_api", "API", t("Middleware API")]];

const savedChecks = (agent: AgentSummary): AgentChecks => agent.checks ?? DEFAULT_AGENT_CHECKS;
const sameChecks = (left: AgentChecks, right: AgentChecks) => columns().every(([key]) => left[key] === right[key]);
/** Middleware API cannot be turned on without a saved URL; it can always be turned off. */
const locked = (agent: AgentSummary, key: CheckKey, value: boolean) => key === "middleware_api" && agent.health_api_url === null && !value;

/** Header checkbox that selects or clears one check for every agent it can change; shows mixed when only some are on. */
function ColumnToggle({ label, name, values, onChange }: { label: string; name: string; values: boolean[]; onChange: (value: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const all = values.length > 0 && values.every(Boolean), some = values.some(Boolean);
  useEffect(() => { if (ref.current) ref.current.indeterminate = some && !all; }, [some, all]);
  return <label className="bulk-checks__column">
    <input ref={ref} type="checkbox" checked={all} disabled={!values.length} aria-label={t("Select All {0}", name)} onChange={() => onChange(!all)} />{label}
  </label>;
}

/** Grid editor: one row per agent with Apache / Nginx / Middleware API checkboxes, plus a select-all per column. Only changed rows are saved. */
export function BulkHealthChecksButton({ projectApiBase, projectName, agents, onSaved }: {
  projectApiBase: string; projectName: string; agents: AgentSummary[]; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, AgentChecks>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { showToast } = useToast();
  const checksOf = (agent: AgentSummary) => draft[agent.id] ?? savedChecks(agent);
  const changed = agents.filter((agent) => !sameChecks(checksOf(agent), savedChecks(agent)));

  function show() { setDraft(Object.fromEntries(agents.map((agent) => [agent.id, savedChecks(agent)]))); setError(null); setOpen(true); }
  function close() { if (!saving) setOpen(false); }
  function setCell(agent: AgentSummary, key: CheckKey, value: boolean) {
    setDraft((current) => ({ ...current, [agent.id]: { ...(current[agent.id] ?? savedChecks(agent)), [key]: value } }));
  }
  function setColumn(key: CheckKey, value: boolean) {
    setDraft((current) => Object.fromEntries(agents.map((agent) => {
      const checks = current[agent.id] ?? savedChecks(agent);
      return [agent.id, locked(agent, key, checks[key]) ? checks : { ...checks, [key]: value }];
    })));
  }
  async function save() {
    if (saving || !changed.length) return;
    setSaving(true); setError(null);
    try {
      const result = await apiFetch<BulkAgentChecksResult>(`${projectApiBase}/agent-checks`, {
        method: "PATCH", body: JSON.stringify({ agents: changed.map((agent) => ({ agent_id: agent.id, checks: checksOf(agent) })) })
      });
      showToast({ tone: "success", message: t(result.updated_count === 1 ? "Health checks updated for {0} agent." : "Health checks updated for {0} agents.", result.updated_count) });
      setOpen(false); onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t("Could not update health checks. Try again."));
    } finally { setSaving(false); }
  }

  return <>
    <button ref={trigger} className="button button--secondary" type="button" aria-haspopup="dialog" aria-controls="bulk-health-checks-dialog"
      aria-label={t("Bulk Health Checks")} disabled={!agents.length} onClick={show}><ListChecks aria-hidden="true" />{t("Health Checks")}</button>
    <ModalDialog id="bulk-health-checks-dialog" open={open} labelledBy="bulk-health-checks-title" describedBy="bulk-health-checks-description"
      dialogClassName="agent-dialog--bulk-checks" surfaceClassName="agent-dialog__surface form-surface bulk-checks" restoreFocusTo={trigger.current} onDismiss={close}>
      <div className="section-heading">
        <div><h2 id="bulk-health-checks-title">{t("Bulk Health Checks")}</h2>
          <p id="bulk-health-checks-description">{projectName}</p></div>
        <button data-dialog-initial-focus className="icon-button" type="button" aria-label={t("Close Bulk Health Checks")} disabled={saving} onClick={close}><X aria-hidden="true" /></button>
      </div>
      <div className="bulk-checks__table-wrap">
        <table className="bulk-checks__table">
          <caption className="visually-hidden">{t("Health Checks Per Agent")}</caption>
          <thead><tr>
            <th scope="col">{t("Agent")}</th>
            {columns().map(([key, label, name]) => <th scope="col" key={key}>
              <ColumnToggle label={label} name={name} values={agents.filter((agent) => !locked(agent, key, checksOf(agent)[key])).map((agent) => checksOf(agent)[key])}
                onChange={(value) => setColumn(key, value)} />
            </th>)}
          </tr></thead>
          <tbody>{agents.map((agent) => {
            const checks = checksOf(agent);
            return <tr key={agent.id} className={sameChecks(checks, savedChecks(agent)) ? undefined : "is-changed"}>
              <th scope="row" title={agent.server_name}>{agent.server_name}</th>
              {columns().map(([key, , name]) => <td key={key}>
                <input type="checkbox" checked={checks[key]} disabled={saving || locked(agent, key, checks[key])}
                  title={locked(agent, key, checks[key]) ? t("No Middleware API URL saved") : undefined}
                  aria-label={t("{0} For {1}", name, agent.server_name)} onChange={(event) => setCell(agent, key, event.target.checked)} />
              </td>)}
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p className="field__help">{t("Changes apply on the next heartbeat. Agents on a script older than 1.5.0 show Needs New Script for checks it does not run. API (Middleware API) is unavailable for agents without a saved URL.")}</p>
      {error ? <p className="field__help field__help--error" role="alert">{error}</p> : null}
      <div className="action-row">
        <button className="button button--secondary" type="button" disabled={saving} onClick={close}>{t("Cancel")}</button>
        <button className="button button--primary" type="button" disabled={saving || !changed.length} onClick={() => void save()}>
          {saving ? <InlineLoader label={t("Saving Checks")} /> : changed.length ? t(changed.length === 1 ? "Save {0} Agent" : "Save {0} Agents", changed.length) : t("No Changes")}
        </button>
      </div>
    </ModalDialog>
  </>;
}
