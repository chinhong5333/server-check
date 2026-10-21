import { hasPermission } from "../../shared/permissions";
import { ListFilter, FolderPlus, Search, X } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { type ProjectSummary } from "../../shared/contracts";
import { EmptyState, ErrorState, PageSkeleton } from "../components/Feedback";
import { ModalDialog } from "../components/ModalDialog";
import { formatCount } from "../lib/format";
import { useProjects } from "../projects/ProjectProvider";
import { CreateProjectForm } from "./CreateProjectPage";
import { ProjectSortMode } from "../components/ProjectSortMode";
import { ProjectCard } from "../components/ProjectCard";
import { useAuth } from "../auth/AuthProvider";
import { NotificationGroupBar } from "../components/NotificationGroup";
import { MaintenanceControl } from "../components/MaintenanceControl";


export function ProjectsPage() {
  const { user } = useAuth();
  const [sortSnapshot, setSortSnapshot] = useState<ProjectSummary[] | null>(null);
  const { projects, status, error, reloadProjects } = useProjects();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectSearch = searchParams.get("project_search") ?? "";
  const searchTerm = projectSearch.trim().toLocaleLowerCase();
  const visibleProjects = searchTerm ? projects.filter(project =>
    project.name.toLocaleLowerCase().includes(searchTerm)
    || (project.agent_names ?? []).some(name => name.toLocaleLowerCase().includes(searchTerm))) : projects;
  const setProjectSearch = (value: string) => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set("project_search", value); else next.delete("project_search");
    return next;
  }, { replace: true });
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
      <NotificationGroupBar />
      <header className="page-header">
        <div>
          <nav className="page-breadcrumb" aria-label="Breadcrumb">
            <ol>
              <li>Server Check</li>
              <li aria-current="page">Projects</li>
            </ol>
          </nav>
          <div className="projects-page__title">
            <h1>Projects</h1>
            {projects.length > 0 ? <span className="numeric section-count">
              Total {formatCount(projects.length)} {projects.length === 1 ? "Project" : "Projects"}
            </span> : null}
          </div>
        </div>
        <div className="projects-page__actions">
          <div className="projects-page__collection-actions">
          {projects.length > 0 && !sortSnapshot ? <label className="roster-search"><Search aria-hidden="true" />
            <span className="visually-hidden">Search Projects Or Agents</span>
            <input type="search" placeholder="Search Projects Or Agents" value={projectSearch} maxLength={120}
              onChange={event => setProjectSearch(event.target.value)} />
          </label> : null}
          {hasPermission(user, "edit_project_settings") && !sortSnapshot && projects.length > 1 && <button type="button" className="button button--secondary"
            onClick={() => setSortSnapshot([...projects])}><ListFilter aria-hidden="true" />Sort</button>}
          </div>
          <div className="projects-page__primary-actions">
          {projects.length > 0 ? <MaintenanceControl endpoint="/api/v1/maintenance/all-projects" scope="All Projects" canManage={user?.role === "admin"}
            detailsTargetId="all-projects-maintenance" onChanged={reloadProjects} /> : null}
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
          </div>
        </div>
      </header>
      <div id="all-projects-maintenance" className="projects-page__maintenance" />

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
        <section className="project-collection" aria-label="All Projects">
          {sortSnapshot && hasPermission(user, "edit_project_settings") ? <ProjectSortMode projects={sortSnapshot} onClose={() => setSortSnapshot(null)}
            onSaved={() => { reloadProjects(); setSortSnapshot(null); }} /> :
          visibleProjects.length === 0 ? <EmptyState
            title="No Matching Projects"
            message="No project or agent name matches this search."
            action={<button className="button button--secondary" type="button" onClick={() => setProjectSearch("")}>Clear Search</button>}
          /> :
          <ul className="project-card-grid">
            {visibleProjects.map((project) => <li key={project.id}><ProjectCard project={project} /></li>)}
          </ul>
          }
        </section>
      )}
    </div>
  );
}
