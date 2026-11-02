import { useCallback } from "react";
import { Link } from "react-router-dom";
import type { IncidentSummary } from "../../shared/contracts";
import { apiFetch } from "../api";
import { EmptyState, ErrorState, PageSkeleton } from "../components/Feedback";
import { StatusBadge } from "../components/StatusBadge";
import { useApiResource } from "../hooks/useApiResource";
import { formatDateTime, formatIdentifierLabel } from "../lib/format";
import { useProjects } from "../projects/ProjectProvider";
import { t } from "../i18n";

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
    return <ErrorState title={t("Couldn't Load Projects")} message={projectError?.message ?? t("Try again.")} onRetry={reloadProjects} />;
  }
  if (!selectedProject) {
    return (
      <EmptyState
        title={t("Project Not Found")}
        message={t("Open a project before viewing its incidents.")}
        action={<Link className="button button--primary" to="/projects">{t("View Projects")}</Link>}
      />
    );
  }
  if (resource.status === "loading") return <PageSkeleton rows={8} />;
  if (resource.status === "error") {
    return <ErrorState title={t("Couldn't Load Incidents")} message={resource.error?.message ?? t("Try again.")} onRetry={resource.reload} />;
  }
  if (!resource.data?.length) {
    return <EmptyState title={t("No Incidents Recorded")} message={t("Threshold violations and missed heartbeats will appear here.")} />;
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-context">{selectedProject.name}</p>
          <h1>{t("Incident History")}</h1>
          <p>{t("Open and recovered conditions remain separate from seven-day raw metrics.")}</p>
        </div>
      </header>
      <section className="data-surface">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t("Server")}</th>
                <th scope="col">{t("State")}</th>
                <th scope="col">{t("Incident")}</th>
                <th scope="col">{t("Probable Cause")}</th>
                <th scope="col">{t("Opened")}</th>
                <th scope="col">{t("Recovered")}</th>
              </tr>
            </thead>
            <tbody>
              {resource.data.map((incident) => (
                <tr key={incident.id}>
                  <th scope="row" data-label={t("Server")}>{incident.server_name}</th>
                  <td data-label={t("State")}><StatusBadge status={incident.status} /></td>
                  <td data-label={t("Incident")} className="mono-label">{formatIdentifierLabel(incident.incident_type)}</td>
                  <td data-label={t("Probable Cause")}>{t(incident.probable_cause)}</td>
                  <td data-label={t("Opened")} className="numeric">{formatDateTime(incident.opened_at)}</td>
                  <td data-label={t("Recovered")} className="numeric">{incident.resolved_at ? formatDateTime(incident.resolved_at) : t("Still Open")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
