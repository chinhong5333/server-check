import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { createProjectBodySchema } from "../../shared/contracts";
import { ApiError, apiFetch } from "../api";
import { InlineLoader } from "../components/Feedback";
import { useToast } from "../components/ToastProvider";
import { useProjects } from "../projects/ProjectProvider";

interface ProjectForm {
  name: string;
}

const initialForm: ProjectForm = { name: "" };

interface CreateProjectFormProps {
  onCreated: (projectId: string) => void;
  onSubmittingChange: (submitting: boolean) => void;
}

export function CreateProjectForm({
  onCreated,
  onSubmittingChange
}: CreateProjectFormProps) {
  const { reloadProjects } = useProjects();
  const { showToast } = useToast();
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const update = (field: keyof ProjectForm, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = { name: form.name };
    const validation = createProjectBodySchema.safeParse(body);
    if (!validation.success) {
      const message = "Enter a project name between 2 and 120 characters.";
      setError(message);
      showToast({ tone: "error", message });
      return;
    }
    setSubmitting(true);
    onSubmittingChange(true);
    setError(null);
    try {
      const result = await apiFetch<{ id: string }>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify(validation.data)
      });
      reloadProjects();
      showToast({ tone: "success", message: "Project created." });
      onCreated(result.id);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : "The project could not be created. Try again.";
      setError(message);
      showToast({ tone: "error", message });
    } finally {
      setSubmitting(false);
      onSubmittingChange(false);
    }
  };

  return (
    <>
      {error ? (
        <div
          ref={errorRef}
          id="create-project-error"
          className="form-banner form-banner--error"
          role="alert"
          tabIndex={-1}
        >
          {error}
        </div>
      ) : null}
      <form
        className="form-grid"
        onSubmit={submit}
        noValidate
        aria-busy={submitting}
        aria-describedby={error ? "create-project-error" : undefined}
      >
          <div className="field field--wide">
            <label htmlFor="project-name">Project Name</label>
            <input
              id="project-name"
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              minLength={2}
              maxLength={120}
              required
              placeholder="Production web"
              data-dialog-initial-focus
            />
            <span className="field__help">Used for grouping agents and Telegram messages.</span>
          </div>
        <button className="button button--primary field--wide" type="submit" disabled={submitting}>
          {submitting ? <InlineLoader label="Creating Project" /> : "Create Project"}
        </button>
      </form>
    </>
  );
}

export function CreateProjectPage() {
  return <Navigate to="/projects" replace />;
}
