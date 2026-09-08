import { ArrowRight, CircleCheck, CircleDashed, CircleX, FolderKanban } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ProjectSummary } from "../../shared/contracts";
import { formatCount } from "../lib/format";

/** The same project card is used for browsing and arranging projects. */
export function ProjectCard({ project, sortingControls }: { project: ProjectSummary; sortingControls?: ReactNode }) {
  const total = project.healthy_agents + project.new_agents + project.warning_agents + project.critical_agents + project.stale_agents;
  const failed = project.warning_agents + project.critical_agents + project.stale_agents;
  const health = failed > 0
    ? { state: "failure", label: "Error", Icon: CircleX, description: `${formatCount(failed)} ${failed === 1 ? "agent needs" : "agents need"} attention.` }
    : project.new_agents > 0
      ? { state: "pending", label: "Awaiting Data", Icon: CircleDashed, description: `${formatCount(project.new_agents)} ${project.new_agents === 1 ? "agent is" : "agents are"} awaiting a first report.` }
      : total === 0
        ? { state: "empty", label: "No Agents", Icon: CircleDashed, description: "Register an agent to begin monitoring." }
        : { state: "healthy", label: "Healthy", Icon: CircleCheck, description: "All registered agents are healthy." };
  return <article className={`project-card project-card--${health.state}`} aria-labelledby={`project-card-${project.id}`}>
    <div className="project-card__header">
      <div className="project-card__identity"><FolderKanban aria-hidden="true" />
        <h3 id={`project-card-${project.id}`} title={project.name}>{project.name}</h3></div>
      <span className={`project-health project-health--${health.state}`}><health.Icon aria-hidden="true" />{health.label}</span>
    </div>
    <div className="project-card__body">
      <div className="project-card__agent-count" aria-label={`Total Agents: ${total}`}><span>Total Agents</span><strong className="numeric">{formatCount(total)}</strong></div>
      <p>{health.description}</p>
    </div>
    <div className="project-card__actions">{sortingControls ?? <Link className="button button--secondary" to={`/projects/${encodeURIComponent(project.id)}`}>Manage<ArrowRight aria-hidden="true" /></Link>}</div>
  </article>;
}
