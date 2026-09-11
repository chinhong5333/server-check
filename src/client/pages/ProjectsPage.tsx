import { hasPermission } from "../../shared/permissions";
import { ListFilter, FolderPlus, X } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { type ProjectSummary } from "../../shared/contracts";
import { EmptyState, ErrorState, PageSkeleton } from "../components/Feedback";
import { ModalDialog } from "../components/ModalDialog";
import { formatCount } from "../lib/format";
import { useProjects } from "../projects/ProjectProvider";
import { CreateProjectForm } from "./CreateProjectPage";
import { ProjectSortMode } from "../components/ProjectSortMode";
import { ProjectCard } from "../components/ProjectCard";
import { useAuth } from "../auth/AuthProvider";


export function ProjectsPage() {
  const { user } = useAuth();
  const [sortSnapshot, setSortSnapshot] = useState<ProjectSummary[] | null>(null);
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
    <div className="page-stack projects-page">
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
          hidden={!hasPermission(user, "edit_project_settings")}
          onClick={openCreateDialog}
          disabled={sortSnapshot !== null}
        >
          <FolderPlus aria-hidden="true" />
          Create Project
        </button>
      </header>

      <ModalDialog
        id="create-project-dialog"
        open={createOpen && hasPermission(user, "edit_project_settings")}
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
              hidden={!hasPermission(user, "edit_project_settings")}
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
            <div className="project-sort__actions"><span className="numeric section-count">
              Total {formatCount(projects.length)} {projects.length === 1 ? "Project" : "Projects"}
            </span>
            {hasPermission(user, "edit_project_settings") && !sortSnapshot && projects.length > 1 && <button type="button" className="button button--secondary"
              onClick={() => setSortSnapshot([...projects])}><ListFilter aria-hidden="true" />Sort</button>}</div>
          </div>
          {sortSnapshot && hasPermission(user, "edit_project_settings") ? <ProjectSortMode projects={sortSnapshot} onClose={() => setSortSnapshot(null)}
            onSaved={() => { reloadProjects(); setSortSnapshot(null); }} /> :
          <ul className="project-card-grid">
            {projects.map((project) => <li key={project.id}><ProjectCard project={project} /></li>)}
          </ul>
          }
        </section>
      )}
    </div>
  );
}
