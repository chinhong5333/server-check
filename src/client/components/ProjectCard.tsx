import { ArrowRight, CircleCheck, CircleDashed, CircleX, FolderKanban } from "lucide-react";
import { Link } from "react-router-dom";
import type { ProjectSummary } from "../../shared/contracts";
import { formatCount } from "../lib/format";
import { ProjectCardAgents } from "./ProjectCardAgents";
import { MaintenanceIcon } from "./MaintenanceIcon";
import { t } from "../i18n";

/** The same project card is used for browsing and arranging projects; while sorting it is visually identical but inert. */
export function ProjectCard({ project, sorting = false }: { project: ProjectSummary; sorting?: boolean }) {
  const total = project.healthy_agents + project.new_agents + project.warning_agents + project.critical_agents + project.stale_agents;
  const failed = project.warning_agents + project.critical_agents + project.stale_agents;
  const health = failed > 0
    ? { state: "failure", label: t("Error"), Icon: CircleX, description: t(failed === 1 ? "{0} agent needs attention." : "{0} agents need attention.", formatCount(failed)) }
    : project.new_agents > 0
      ? { state: "pending", label: t("Awaiting Data"), Icon: CircleDashed, description: t(project.new_agents === 1 ? "{0} agent is awaiting a first report." : "{0} agents are awaiting a first report.", formatCount(project.new_agents)) }
      : total === 0
        ? { state: "empty", label: t("No Agents"), Icon: CircleDashed, description: t("Register an agent to begin monitoring.") }
        : { state: "healthy", label: t("Healthy"), Icon: CircleCheck, description: t("All registered agents are healthy.") };
  const mix = [
    { key: "healthy", label: t("Healthy"), count: project.healthy_agents },
    { key: "warning", label: t("Warning"), count: project.warning_agents },
    { key: "critical", label: t("Critical"), count: project.critical_agents },
    { key: "stale", label: t("Stale"), count: project.stale_agents },
    { key: "new", label: t("Awaiting Data"), count: project.new_agents }
  ].filter((item) => item.count > 0);
  return <article className={`project-card project-card--${health.state}${project.agents_preview?.length ? " project-card--with-agents" : ""}`} aria-labelledby={`project-card-${project.id}`} inert={sorting}>
    <div className="project-card__header">
      <div className="project-card__identity"><FolderKanban aria-hidden="true" />
        <h3 id={`project-card-${project.id}`} title={project.name}>{project.name}</h3><MaintenanceIcon maintenance={project.maintenance} /></div>
      <span className={`project-health project-health--${health.state}`}><health.Icon aria-hidden="true" />{health.label}</span>
    </div>
    <div className="project-card__body">
      <div className="project-card__agent-count" aria-label={t("Total Agents: {0}", total)}><span>{t("Total Agents")}</span><strong className="numeric">{formatCount(total)}</strong></div>
      <p>{health.description}</p>
      {mix.length > 0 ? <div className="project-card__mix">
        <div className="project-card__mix-bar" aria-hidden="true">
          {mix.map((item) => <span key={item.key} className={`project-card__mix-segment project-card__mix-segment--${item.key}`} style={{ flexGrow: item.count }} />)}
        </div>
        <p className="project-card__mix-legend">
          {mix.map((item) => <span key={item.key} data-status={item.key}><span className="project-card__mix-swatch" aria-hidden="true" />{`${formatCount(item.count)} ${item.label}`}</span>)}
        </p>
      </div> : null}
    </div>
    <ProjectCardAgents project={project} total={total} />
    <div className="project-card__actions">{sorting
      ? <span className="button button--secondary">{t("Manage")}<ArrowRight aria-hidden="true" /></span>
      : <Link className="button button--secondary" to={`/projects/${encodeURIComponent(project.id)}`}>{t("Manage")}<ArrowRight aria-hidden="true" /></Link>}</div>
  </article>;
}
