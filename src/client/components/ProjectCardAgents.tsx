import { ArrowRight, FolderKanban, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentSummary, ProjectSummary } from "../../shared/contracts";
import { apiFetch } from "../api";
import { ModalDialog } from "./ModalDialog";
import { StatusBadge, statusConfig } from "./StatusBadge";

type DirectoryAgent = Pick<AgentSummary, "id" | "server_name" | "status">;

export function ProjectCardAgents({ project, total }: { project: ProjectSummary; total: number }) {
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<DirectoryAgent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const preview = project.agents_preview ?? [];
  const showAll = total > 6;
  const visible = preview.slice(0, showAll ? 5 : 6);
  const dialogId = `project-agents-${project.id}`;
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;

  async function loadAgents() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setAgents(null);
    setError(null);
    setLoading(true);
    try {
      const result = await apiFetch<AgentSummary[]>(`/api/v1/projects/${encodeURIComponent(project.id)}/agents`, {
        signal: controller.signal
      });
      if (!controller.signal.aborted) setAgents(result.map(({ id, server_name, status }) => ({ id, server_name, status })));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load agents.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function close() {
    request.current?.abort();
    setOpen(false);
  }

  if (visible.length === 0) return null;

  return <>
    <section className="project-card__roster" aria-labelledby={`${dialogId}-preview-title`}>
      <div className="project-card__roster-heading"><h4 id={`${dialogId}-preview-title`}>Agents</h4></div>
      <ul className="project-card__agent-grid">
        {visible.map((agent) => {
          const config = statusConfig[agent.status];
          const Icon = config.icon;
          return <li key={agent.id} data-status={agent.status}
            aria-label={`${agent.server_name}: ${config.label}`} title={`${agent.server_name} · ${config.label}`}>
            <Icon aria-hidden="true" /><span className="project-card__agent-name">{agent.server_name}</span>
          </li>;
        })}
        {showAll && <li className="project-card__view-all-item">
          <button ref={trigger} className="project-card__view-all" type="button"
            aria-label={`View All ${total} Agents`} aria-haspopup="dialog" aria-controls={dialogId}
            onClick={() => { setOpen(true); void loadAgents(); }}>
            View All<ArrowRight aria-hidden="true" />
          </button>
        </li>}
      </ul>
    </section>
    {showAll && <ModalDialog id={dialogId} open={open} labelledBy={titleId}
      describedBy={descriptionId} restoreFocusTo={trigger.current}
      surfaceClassName="agent-dialog__surface form-surface project-agent-dialog__surface">
      <div className="section-heading">
        <div>
          <h2 id={titleId}>All Agents</h2>
          <p className="project-agent-dialog__project"><FolderKanban aria-hidden="true" /><span>{project.name}</span></p>
          <p id={descriptionId}>{agents ? agents.length : total} registered agents.</p>
        </div>
        <button className="icon-button" type="button" data-dialog-initial-focus
          aria-label="Close All Agents" onClick={close}><X aria-hidden="true" /></button>
      </div>
      {loading ? <p className="project-agent-dialog__message" role="status">Loading Agents…</p>
        : error ? <div className="project-agent-dialog__message" role="alert">
          <p>{error}</p><button className="button button--secondary" type="button" onClick={() => void loadAgents()}>Retry Loading Agents</button>
        </div>
        : agents?.length ? <ul className="project-agent-dialog__list">
          {agents.map((agent) => <li key={agent.id}><strong>{agent.server_name}</strong><StatusBadge status={agent.status} /></li>)}
        </ul>
        : <p className="project-agent-dialog__message" role="status">No Agents Registered</p>}
    </ModalDialog>}
  </>;
}
