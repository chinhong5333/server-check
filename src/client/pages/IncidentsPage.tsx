import { useCallback } from "react";
import { Link } from "react-router-dom";
import type { IncidentSummary } from "../../shared/contracts";
import { apiFetch } from "../api";
import { EmptyState, ErrorState, PageSkeleton } from "../components/Feedback";
import { StatusBadge } from "../components/StatusBadge";
import { useApiResource } from "../hooks/useApiResource";
import { formatDateTime, formatIdentifierLabel } from "../lib/format";
import { useProjects } from "../projects/ProjectProvider";

export function IncidentsPage() {
  const {
    selectedProject,
    status: projectStatus,
    error: projectError,
    reloadProjects
  } = useProjects();
  const projectId = selectedProject?.id ?? "none";
  const load = useCallback(
    () =>
      selectedProject
        ? apiFetch<IncidentSummary[]>(`/api/v1/projects/${selectedProject.id}/incidents`)
        : Promise.resolve([]),
    [selectedProject]
  );
  const resource = useApiResource<IncidentSummary[]>(`incidents-page:${projectId}`, load);

  if (projectStatus === "loading") return <PageSkeleton rows={6} />;
  if (projectStatus === "error") {
    return <ErrorState title="Couldn't Load Projects" message={projectError?.message ?? "Try again."} onRetry={reloadProjects} />;
  }
  if (!selectedProject) {
    return (
      <EmptyState
        title="Project Not Found"
        message="Open a project before viewing its incidents."
        action={<Link className="button button--primary" to="/projects">View Projects</Link>}
      />
    );
  }
  if (resource.status === "loading") return <PageSkeleton rows={8} />;
  if (resource.status === "error") {
    return <ErrorState title="Couldn't Load Incidents" message={resource.error?.message ?? "Try again."} onRetry={resource.reload} />;
  }
  if (!resource.data?.length) {
    return <EmptyState title="No Incidents Recorded" message="Threshold violations and missed heartbeats will appear here." />;
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-context">{selectedProject.name}</p>
          <h1>Incident History</h1>
          <p>Open and recovered conditions remain separate from seven-day raw metrics.</p>
        </div>
      </header>
      <section className="data-surface">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Server</th>
                <th scope="col">State</th>
                <th scope="col">Incident</th>
                <th scope="col">Probable Cause</th>
                <th scope="col">Opened</th>
                <th scope="col">Recovered</th>
              </tr>
            </thead>
            <tbody>
              {resource.data.map((incident) => (
                <tr key={incident.id}>
                  <th scope="row" data-label="Server">{incident.server_name}</th>
                  <td data-label="State"><StatusBadge status={incident.status} /></td>
                  <td data-label="Incident" className="mono-label">{formatIdentifierLabel(incident.incident_type)}</td>
                  <td data-label="Probable Cause">{incident.probable_cause}</td>
                  <td data-label="Opened" className="numeric">{formatDateTime(incident.opened_at)}</td>
                  <td data-label="Recovered" className="numeric">{incident.resolved_at ? formatDateTime(incident.resolved_at) : "Still Open"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
