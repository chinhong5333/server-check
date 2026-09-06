import { ArrowRight } from "lucide-react";
import { useCallback, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { AgentSummary, IncidentSummary } from "../../shared/contracts";
import { apiFetch } from "../api";
import { EmptyState, ErrorState, PageSkeleton } from "../components/Feedback";
import { agentStateCause } from "../components/AgentStateDisplay";
import { StatusBadge } from "../components/StatusBadge";
import { MetricValue } from "../components/MetricValue";
import { useApiResource } from "../hooks/useApiResource";
import { formatCount, formatLatency, formatPercent, formatRatio, formatRelativeTime } from "../lib/format";
import { useProjects } from "../projects/ProjectProvider";

export function OverviewPage() {
  const { projects, selectedProject, status: projectStatus, error: projectError, reloadProjects } = useProjects();
  const projectId = selectedProject?.id ?? "none";
  const loadAgents = useCallback(
    () =>
      selectedProject
        ? apiFetch<AgentSummary[]>(`/api/v1/projects/${selectedProject.id}/agents`)
        : Promise.resolve([]),
    [selectedProject]
  );
  const loadIncidents = useCallback(
    () =>
      selectedProject
        ? apiFetch<IncidentSummary[]>(`/api/v1/projects/${selectedProject.id}/incidents`)
        : Promise.resolve([]),
    [selectedProject]
  );
  const agents = useApiResource<AgentSummary[]>(`agents:${projectId}`, loadAgents);
  const incidents = useApiResource<IncidentSummary[]>(`incidents:${projectId}`, loadIncidents);

  if (projectStatus === "loading") return <PageSkeleton rows={7} />;
  if (projectStatus === "error") {
    return (
      <ErrorState
        title="Couldn't Load Projects"
        message={projectError?.message ?? "Check the central API and database connection."}
        onRetry={reloadProjects}
      />
    );
  }
  if (!selectedProject) {
    const projectsExist = projects.length > 0;
    return (
      <EmptyState
        title={projectsExist ? "Project Not Found" : "No Projects Yet"}
        message={
          projectsExist
            ? "Open an existing project to view its overview."
            : "Create a project before registering agents."
        }
        action={
          <Link className="button button--primary" to="/projects">
            {projectsExist ? "View Projects" : "Create Project"}
          </Link>
        }
      />
    );
  }

  const projectBase = `/projects/${encodeURIComponent(selectedProject.id)}`;
  const openIncidents = (incidents.data ?? []).filter((incident) => incident.status === "open");

  return (
    <div className="page-stack">
      <header className="page-header reveal" style={{ "--i": 0 } as CSSProperties}>
        <div>
          <p className="page-context">{selectedProject.name}</p>
          <h1>Operations Overview</h1>
          <p>Current liveness and the latest probable cause from every monitored server.</p>
        </div>
      </header>

      <section className="policy-strip reveal" style={{ "--i": 1 } as CSSProperties} aria-label="Project Policy">
        <div>
          <span>RAM Alert Below</span>
          <strong className="numeric">{formatPercent(selectedProject.ram_available_threshold_percent)}</strong>
        </div>
        <div>
          <span>Storage Alert Below</span>
          <strong className="numeric">{formatPercent(selectedProject.disk_available_threshold_percent)}</strong>
        </div>
        <div>
          <span>5-Minute Load Threshold</span>
          <strong className="numeric">{formatRatio(selectedProject.load_5_per_core_threshold)}</strong>
        </div>
        <div>
          <span>Open Incidents</span>
          <strong className="numeric">{formatCount(openIncidents.length)}</strong>
        </div>
      </section>

      {agents.status === "loading" ? <PageSkeleton rows={6} /> : null}
      {agents.status === "error" ? (
        <ErrorState
          title="Couldn't Load Monitored Servers"
          message={agents.error?.message ?? "Try the request again."}
          onRetry={agents.reload}
        />
      ) : null}
      {agents.status === "success" && agents.data?.length === 0 ? (
        <EmptyState
          title="No Agents Registered"
          message="This project can register multiple agents. Register the first server to begin monitoring."
          action={
            <Link className="button button--primary" to={`${projectBase}/agents`}>
              Register First Agent
            </Link>
          }
        />
      ) : null}
      {agents.status === "success" && agents.data && agents.data.length > 0 ? (
        <section className="data-surface reveal" style={{ "--i": 2 } as CSSProperties}>
          <div className="section-heading">
            <div>
              <h2>Monitored Servers</h2>
              <p>Unhealthy and stale agents are listed first.</p>
            </div>
            <span className="numeric section-count">{formatCount(agents.data.length)} total</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Server</th>
                  <th scope="col">State</th>
                  <th scope="col">Probable Cause</th>
                  <th scope="col">Resources</th>
                  <th scope="col">Health API</th>
                  <th scope="col">Last Heartbeat</th>
                  <th scope="col"><span className="visually-hidden">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {agents.data.map((agent) => (
                  <tr key={agent.id}>
                    <th scope="row" data-label="Server" className="server-cell">
                      <strong>{agent.server_name}</strong>
                      <small>{agent.agent_version ? `Agent ${agent.agent_version}` : "Version Pending"}</small>
                    </th>
                    <td data-label="State"><StatusBadge status={agent.status} /></td>
                    <td data-label="Probable Cause">{agentStateCause(agent.status, agent.probable_cause) ?? "—"}</td>
                    <td data-label="Resources">
                      <div className="resource-stack numeric">
                        <span><small>RAM</small><MetricValue value={agent.ram_available_percent} format={formatPercent} /></span>
                        <span><small>Disk</small><MetricValue value={agent.disk_available_percent} format={formatPercent} /></span>
                        <span><small>Load</small><MetricValue value={agent.load_5_per_core} format={formatRatio} /></span>
                      </div>
                    </td>
                    <td
                      data-label="Health API"
                      aria-label={agent.health_outcome === null ? "Health API: no data" : undefined}
                    >
                      <span className="numeric">
                        {agent.health_outcome === null
                          ? "--"
                          : agent.health_outcome === "healthy"
                            ? `HTTP ${agent.health_http_status_code ?? 200} · ${formatLatency(agent.health_latency_ms)}`
                            : agent.health_http_status_code
                              ? `HTTP ${agent.health_http_status_code}`
                              : "Request failed"}
                      </span>
                    </td>
                    <td data-label="Last Heartbeat" title={agent.last_heartbeat_at ? new Date(agent.last_heartbeat_at).toISOString() : undefined}>
                      {formatRelativeTime(agent.last_heartbeat_at)}
                    </td>
                    <td className="row-action">
                      <Link
                        className="icon-button"
                        aria-label={`View Agent Detail For ${agent.server_name}`}
                        title="View Agent Detail"
                        to={`${projectBase}/agents/${encodeURIComponent(agent.id)}`}
                      >
                        <ArrowRight aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
