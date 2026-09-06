import { ArrowRight, CircleCheck, CircleDashed, CircleX, FolderKanban, FolderPlus, X } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { type ProjectSummary } from "../../shared/contracts";
import { EmptyState, ErrorState, PageSkeleton } from "../components/Feedback";
import { ModalDialog } from "../components/ModalDialog";
import { formatCount } from "../lib/format";
import { useProjects } from "../projects/ProjectProvider";
import { CreateProjectForm } from "./CreateProjectPage";

function agentCountFor(project: ProjectSummary): number {
  return (
    project.healthy_agents +
    project.new_agents +
    project.warning_agents +
    project.critical_agents +
    project.stale_agents
  );
}

type ProjectHealthState = "healthy" | "failure" | "pending" | "empty";

function projectHealthFor(project: ProjectSummary): {
  state: ProjectHealthState;
  label: string;
  description: string;
  Icon: typeof CircleCheck;
} {
  const totalAgents = agentCountFor(project);
  const failedAgents = project.warning_agents + project.critical_agents + project.stale_agents;
  if (failedAgents > 0) {
    return {
      state: "failure",
      label: "Error",
      description: `${formatCount(failedAgents)} ${failedAgents === 1 ? "agent needs" : "agents need"} attention.`,
      Icon: CircleX
    };
  }
  if (project.new_agents > 0) {
    return {
      state: "pending",
      label: "Awaiting Data",
      description: `${formatCount(project.new_agents)} ${project.new_agents === 1 ? "agent is" : "agents are"} awaiting a first report.`,
      Icon: CircleDashed
    };
  }
  if (totalAgents === 0) {
    return {
      state: "empty",
      label: "No Agents",
      description: "Register an agent to begin monitoring.",
      Icon: CircleDashed
    };
  }
  return {
    state: "healthy",
    label: "Healthy",
    description: "All registered agents are healthy.",
    Icon: CircleCheck
  };
}

export function ProjectsPage() {
  const { projects, status, error, reloadProjects } = useProjects();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement | null>(null);
  const openCreateDialog = (event: MouseEvent<HTMLButtonElement>) => {
    createTriggerRef.current = event.currentTarget;
    setCreateOpen(true);
  };

  const closeCreateDialog = () => {
    if (!creating) setCreateOpen(false);
  };

  if (status === "loading") return <PageSkeleton rows={6} />;
  if (status === "error") {
    return (
      <ErrorState
        title="Couldn't Load Projects"
        message={error?.message ?? "Check the central API and try again."}
        onRetry={reloadProjects}
      />
    );
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <h1>Projects</h1>
          <p>Review every project and the health of its registered agents.</p>
        </div>
        <button
          className="button button--primary"
          type="button"
          aria-haspopup="dialog"
          aria-controls="create-project-dialog"
          onClick={openCreateDialog}
        >
          <FolderPlus aria-hidden="true" />
          Create Project
        </button>
      </header>

      <ModalDialog
        id="create-project-dialog"
        open={createOpen}
        labelledBy="create-project-title"
        describedBy="create-project-description"
        surfaceClassName="agent-dialog__surface form-surface"
        restoreFocusTo={createTriggerRef.current}
      >
        <div className="section-heading">
          <div>
            <h2 id="create-project-title">Create Project</h2>
            <p id="create-project-description">
              Create one monitoring boundary. Agents can be registered after the project is saved.
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close Project Creation"
            disabled={creating}
            onClick={closeCreateDialog}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <CreateProjectForm
          onSubmittingChange={setCreating}
          onCreated={(projectId) => {
            setCreateOpen(false);
            navigate(`/projects/${encodeURIComponent(projectId)}`);
          }}
        />
      </ModalDialog>

      {projects.length === 0 ? (
        <EmptyState
          title="No Projects Yet"
          message="Create a project to define its settings and register agents."
          action={
            <button
              className="button button--primary"
              type="button"
              aria-haspopup="dialog"
              aria-controls="create-project-dialog"
              onClick={openCreateDialog}
            >
              Create First Project
            </button>
          }
        />
      ) : (
        <section className="project-collection" aria-labelledby="all-projects-title">
          <div className="section-heading">
            <div>
              <h2 id="all-projects-title">All Projects</h2>
            </div>
            <span className="numeric section-count">
              Total {formatCount(projects.length)} {projects.length === 1 ? "Project" : "Projects"}
            </span>
          </div>
          <ul className="project-card-grid">
            {projects.map((project) => {
              const agentCount = agentCountFor(project);
              const health = projectHealthFor(project);
              const HealthIcon = health.Icon;
              return (
                <li key={project.id}>
                  <article className={`project-card project-card--${health.state}`} aria-labelledby={`project-card-${project.id}`}>
                    <div className="project-card__header">
                      <div className="project-card__identity">
                        <FolderKanban aria-hidden="true" />
                        <h3 id={`project-card-${project.id}`} title={project.name}>{project.name}</h3>
                      </div>
                      <span className={`project-health project-health--${health.state}`}>
                        <HealthIcon aria-hidden="true" />
                        {health.label}
                      </span>
                    </div>
                    <div className="project-card__body">
                      <div className="project-card__agent-count" aria-label={`Total Agents: ${agentCount}`}>
                        <span>Total Agents</span>
                        <strong className="numeric">{formatCount(agentCount)}</strong>
                      </div>
                      <p>{health.description}</p>
                    </div>
                    <div className="project-card__actions">
                      <Link className="button button--secondary" to={`/projects/${encodeURIComponent(project.id)}`}>
                        Manage
                        <ArrowRight aria-hidden="true" />
                      </Link>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
