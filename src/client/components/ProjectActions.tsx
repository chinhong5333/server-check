import { useAuth } from "../auth/AuthProvider";
import { hasPermission } from "../../shared/permissions";
import { Settings, ShieldAlert, Trash2, X } from "lucide-react";
import { useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { updateProjectBodySchema, type ProjectSummary } from "../../shared/contracts";
import { ApiError, apiFetch } from "../api";
import { InlineLoader } from "./Feedback";
import { ModalDialog } from "./ModalDialog";
import { useToast } from "./ToastProvider";
import { useProjects } from "../projects/ProjectProvider";

function agentCountFor(project: ProjectSummary): number {
  return project.healthy_agents + project.new_agents + project.warning_agents + project.critical_agents + project.stale_agents;
}

export function ProjectActions({ project }: { project: ProjectSummary }) {
  const { user } = useAuth();
  const { reloadProjects } = useProjects();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const renameTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [projectPendingRename, setProjectPendingRename] = useState<ProjectSummary | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [projectPendingDelete, setProjectPendingDelete] = useState<ProjectSummary | null>(null);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [confirmationName, setConfirmationName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);


  const openRenameDialog = (project: ProjectSummary, event: MouseEvent<HTMLButtonElement>) => {
    renameTriggerRef.current = event.currentTarget;
    setProjectPendingRename(project);
    setRenameName(project.name);
    setRenameError(null);
  };

  const closeRenameDialog = () => {
    if (renaming) return;
    setProjectPendingRename(null);
    setRenameName("");
    setRenameError(null);
  };

  const renameProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectPendingRename) return;
    const validation = updateProjectBodySchema.safeParse({ name: renameName });
    if (!validation.success) {
      setRenameError("Enter a project name between 2 and 120 characters.");
      return;
    }

    setRenaming(true);
    setRenameError(null);
    try {
      await apiFetch<void>(`/api/v1/projects/${encodeURIComponent(projectPendingRename.id)}`, {
        method: "PUT",
        body: JSON.stringify(validation.data)
      });
      setProjectPendingRename(null);
      setRenameName("");
      reloadProjects();
      showToast({ tone: "success", message: "Project name updated." });
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : "The project name could not be updated.";
      setRenameError(message);
      showToast({ tone: "error", message });
    } finally {
      setRenaming(false);
    }
  };

  const openDeleteDialog = (
    project: ProjectSummary,
    event: MouseEvent<HTMLButtonElement>
  ) => {
    deleteTriggerRef.current = event.currentTarget;
    setProjectPendingDelete(project);
    setDeleteStep(1);
    setConfirmationName("");
    setDeleteError(null);
  };

  const closeDeleteDialog = () => {
    if (deleting) return;
    setProjectPendingDelete(null);
    setDeleteStep(1);
    setConfirmationName("");
    setDeleteError(null);
  };

  const deleteProject = async () => {
    if (!projectPendingDelete || confirmationName !== projectPendingDelete.name) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch<void>(
        `/api/v1/projects/${encodeURIComponent(projectPendingDelete.id)}`,
        {
          method: "DELETE",
          body: JSON.stringify({ confirmation_name: confirmationName })
        }
      );
      setProjectPendingDelete(null);
      setDeleteStep(1);
      setConfirmationName("");
      reloadProjects();
      navigate("/projects", { replace: true });
      showToast({
        tone: "success",
        message: "Project deleted. Agent access revoked."
      });
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : "The project could not be deleted.";
      setDeleteError(message);
      showToast({ tone: "error", message });
    } finally {
      setDeleting(false);
    }
  };


  return (
    <div className="project-management-actions">
      <button className="button button--secondary" type="button"
        hidden={!hasPermission(user, "edit_project_settings")} aria-haspopup="dialog" aria-controls="rename-project-dialog"
        onClick={(event) => openRenameDialog(project, event)}>
        <Settings aria-hidden="true" /> Rename Project
      </button>
      <button className="button button--secondary project-delete-action" type="button"
        hidden={!hasPermission(user, "delete_projects")} aria-haspopup="dialog" aria-controls="delete-project-dialog"
        onClick={(event) => openDeleteDialog(project, event)}>
        <Trash2 aria-hidden="true" /> Delete Project
      </button>
      <ModalDialog
        id="rename-project-dialog"
        open={Boolean(projectPendingRename) && hasPermission(user, "edit_project_settings")}
        labelledBy="rename-project-title"
        describedBy="rename-project-description"
        dialogClassName="agent-dialog--project-rename"
        surfaceClassName="agent-dialog__surface form-surface"
        restoreFocusTo={renameTriggerRef.current}
      >
        {projectPendingRename ? (
          <>
            <div className="section-heading">
              <div>
                <h2 id="rename-project-title">Rename Project</h2>
                <p id="rename-project-description">Change the project name shown throughout the admin panel.</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close Project Rename"
                disabled={renaming}
                onClick={closeRenameDialog}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <form className="form-grid" onSubmit={(event) => void renameProject(event)}>
              <div className="field field--wide">
                <label htmlFor="project-rename-name">Project Name</label>
                <input
                  id="project-rename-name"
                  data-dialog-initial-focus
                  autoComplete="off"
                  maxLength={120}
                  value={renameName}
                  onChange={(event) => {
                    setRenameName(event.target.value);
                    setRenameError(null);
                  }}
                  aria-describedby={renameError ? "project-rename-error" : undefined}
                  aria-invalid={Boolean(renameError)}
                  required
                />
                {renameError ? (
                  <span id="project-rename-error" className="field__help field__help--error" role="alert">
                    {renameError}
                  </span>
                ) : null}
              </div>
              <button
                className="button button--primary field--wide"
                type="submit"
                disabled={
                  renaming ||
                  renameName.trim() === projectPendingRename.name ||
                  !updateProjectBodySchema.safeParse({ name: renameName }).success
                }
              >
                {renaming ? <InlineLoader label="Updating Project Name" /> : "Save Name"}
              </button>
            </form>
          </>
        ) : null}
      </ModalDialog>

      <ModalDialog
        id="delete-project-dialog"
        open={Boolean(projectPendingDelete) && hasPermission(user, "delete_projects")}
        labelledBy="delete-project-title"
        describedBy="delete-project-description"
        surfaceClassName="agent-dialog__surface agent-delete-confirmation"
        restoreFocusTo={deleteTriggerRef.current}
      >
        {projectPendingDelete ? (
          <>
            <div>
              <ShieldAlert aria-hidden="true" />
              <div>
                <h2 id="delete-project-title">
                  {deleteStep === 1
                    ? `Delete ${projectPendingDelete.name}?`
                    : "Final Confirmation"}
                </h2>
                <p id="delete-project-description">
                  {deleteStep === 1
                    ? `Confirmation 1 of 2. This revokes ${agentCountFor(projectPendingDelete)} registered agents, resolves open incidents, and cancels pending alerts. History is retained.`
                    : `Confirmation 2 of 2. Type ${projectPendingDelete.name} exactly to enable deletion.`}
                </p>
              </div>
              <button
                data-dialog-initial-focus={deleteStep === 1 ? true : undefined}
                className="icon-button"
                type="button"
                aria-label="Close Project Deletion"
                disabled={deleting}
                onClick={closeDeleteDialog}
              >
                <X aria-hidden="true" />
              </button>
            </div>

            {deleteStep === 1 ? (
              <div className="action-row">
                <button
                  className="button button--danger"
                  type="button"
                  onClick={() => setDeleteStep(2)}
                >
                  Continue Deletion
                </button>
              </div>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="project-delete-confirmation-name">
                    Project Name
                  </label>
                  <input
                    id="project-delete-confirmation-name"
                    autoFocus
                    autoComplete="off"
                    value={confirmationName}
                    onChange={(event) => {
                      setConfirmationName(event.target.value);
                      setDeleteError(null);
                    }}
                    aria-describedby="project-delete-confirmation-help"
                  />
                  <span id="project-delete-confirmation-help" className="field__help">
                    Enter {projectPendingDelete.name} exactly.
                  </span>
                </div>
                {deleteError ? (
                  <p className="field__help field__help--error" role="alert">
                    {deleteError}
                  </p>
                ) : null}
                <div className="action-row">
                  <button
                    className="button button--danger"
                    type="button"
                    disabled={deleting || confirmationName !== projectPendingDelete.name}
                    onClick={() => void deleteProject()}
                  >
                    {deleting ? <InlineLoader label="Deleting Project" /> : "Delete Project"}
                  </button>
                </div>
              </>
            )}
          </>
        ) : null}
      </ModalDialog>


    </div>
  );
}
