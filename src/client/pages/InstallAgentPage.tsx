import { hasPermission } from "../../shared/permissions";
import { ArrowLeft, ArrowRight, Download, KeyRound, Pencil, Plus, ShieldAlert, TerminalSquare, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import {
  generateAgentScriptBodySchema,
  DEFAULT_AGENT_CHECKS,
  type AgentChecks,
  type AgentEditableInput,
  type AgentSummary,
  type AgentInstallationResponse
} from "../../shared/contracts";
import { ApiError, apiFetch } from "../api";
import { AgentScriptChecks } from "../components/AgentScriptChecks";
import { AgentForm } from "../components/AgentForm";
import { AgentStateDisplay } from "../components/AgentStateDisplay";
import { CopyButton } from "../components/CopyButton";
import { EmptyState, ErrorState, InlineLoader, PageSkeleton } from "../components/Feedback";
import { ModalDialog } from "../components/ModalDialog";
import { ProjectActions } from "../components/ProjectActions";
import { MetricValue } from "../components/MetricValue";
import { useToast } from "../components/ToastProvider";
import { FAST_REFRESH_INTERVAL_MS, useApiResource } from "../hooks/useApiResource";
import {
  formatCount,
  formatPercent,
  formatLoadAverage,
  formatRelativeTime,
  utilizationFromAvailable
} from "../lib/format";
import { useProjects } from "../projects/ProjectProvider";

function AgentHeartbeatStatus({ agent }: { agent: AgentSummary }) {
  const heartbeatOverdue = agent.last_heartbeat_at !== null
    && Date.now() >= agent.last_heartbeat_at + agent.heartbeat_interval_seconds * 1000;

  return (
    <div className="agent-heartbeat">
      <span>{formatRelativeTime(agent.last_heartbeat_at)}</span>
      {heartbeatOverdue ? (
        <small className="agent-heartbeat__warning">
          <TriangleAlert aria-hidden="true" />
          Exceeds Heartbeat Interval
        </small>
      ) : null}
    </div>
  );
}

export function InstallAgentPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rotationTarget = searchParams.get("rotate_agent");
  const { showToast } = useToast();
  const {
    selectedProject,
    status: projectStatus,
    error: projectError,
    reloadProjects
  } = useProjects();
  const projectId = selectedProject?.id ?? "none";
  const loadAgents = useCallback(
    () =>
      projectId !== "none"
        ? apiFetch<AgentSummary[]>(`/api/v1/projects/${projectId}/agents`)
        : Promise.resolve([]),
    [projectId]
  );
  const agents = useApiResource<AgentSummary[]>(`agents:${projectId}`, loadAgents, {
    refreshIntervalMs: FAST_REFRESH_INTERVAL_MS
  });
  const registrationButtonRef = useRef<HTMLButtonElement>(null);
  const registrationHealthUrlRef = useRef<HTMLInputElement>(null);
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const rotateTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const installationBackButtonRef = useRef<HTMLButtonElement>(null);
  const installationExitActionRef = useRef<HTMLButtonElement>(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registrationStep, setRegistrationStep] = useState<"settings" | "script">("settings");
  const [pendingRegistration, setPendingRegistration] = useState<AgentEditableInput | null>(null);
  const [registrationHealthUrl, setRegistrationHealthUrl] = useState("");
  const [registrationChecks, setRegistrationChecks] = useState<AgentChecks>({ ...DEFAULT_AGENT_CHECKS });
  const [rotationChecks, setRotationChecks] = useState<AgentChecks>({ ...DEFAULT_AGENT_CHECKS });
  const [editingAgent, setEditingAgent] = useState<AgentSummary | null>(null);
  const [agentPendingRotation, setAgentPendingRotation] = useState<AgentSummary | null>(null);
  const [rotationHealthUrl, setRotationHealthUrl] = useState("");
  const [agentPendingDelete, setAgentPendingDelete] = useState<AgentSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [installation, setInstallation] = useState<AgentInstallationResponse | null>(null);
  const [installationProjectName, setInstallationProjectName] = useState<string | null>(null);
  const [installationAgentName, setInstallationAgentName] = useState<string | null>(null);
  const [installationOperation, setInstallationOperation] = useState<"created" | "rotated" | null>(null);
  const [installationExitStep, setInstallationExitStep] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    if (installationExitStep === 2) installationExitActionRef.current?.focus();
  }, [installationExitStep]);

  useEffect(() => {
    if (registrationOpen && registrationStep === "script") {
      queueMicrotask(() => registrationHealthUrlRef.current?.focus());
    }
  }, [registrationOpen, registrationStep]);

  useEffect(() => {
    setRegistrationOpen(false);
    setRegistrationStep("settings");
    setPendingRegistration(null);
    setRegistrationHealthUrl("");
    setEditingAgent(null);
    setAgentPendingRotation(null);
    setRotationHealthUrl("");
    setAgentPendingDelete(null);
    setError(null);
    setDeleteError(null);
  }, [projectId]);

  useEffect(() => {
    if (!rotationTarget || projectStatus !== "success" || projectId === "none") return;
    const consumeRequest = () => setSearchParams((current) => {
      const next = new URLSearchParams(current); next.delete("rotate_agent"); return next;
    }, { replace: true });
    if (!hasPermission(user, "rotate_agent_secrets")) { consumeRequest(); return; }
    const controller = new AbortController();
    // Fetch this project's current settings rather than using a previous route's cached roster.
    void apiFetch<AgentSummary[]>(`/api/v1/projects/${encodeURIComponent(projectId)}/agents`, { signal: controller.signal })
      .then((rows) => {
        if (controller.signal.aborted) return;
        const target = rows.find((agent) => agent.id === rotationTarget);
        if (!target) throw new Error("The selected agent is no longer available in this project.");
        setRegistrationOpen(false); setEditingAgent(null); setAgentPendingDelete(null); setError(null);
        setAgentPendingRotation(target);
        setRotationHealthUrl(target.health_api_url ?? "");
        setRotationChecks(target.checks ?? { ...DEFAULT_AGENT_CHECKS });
        consumeRequest();
      }).catch((cause) => {
        if (!controller.signal.aborted) {
          showToast({ tone: "error", message: cause instanceof Error ? cause.message : "Could not open access secret rotation." });
          consumeRequest();
        }
      });
    return () => controller.abort();
  }, [rotationTarget, projectId, projectStatus, user?.role, setSearchParams, showToast]);

  if (projectStatus === "loading") return <PageSkeleton rows={5} />;
  if (projectStatus === "error") {
    return (
      <ErrorState
        title="Couldn't Load Projects"
        message={projectError?.message ?? "Check the central API and try again."}
        onRetry={reloadProjects}
      />
    );
  }
  if (!selectedProject) {
    return (
      <EmptyState
        title="Project Not Found"
        message="Open a project before viewing or registering its agents."
        action={<Link className="button button--primary" to="/projects">View Projects</Link>}
      />
    );
  }

  const projectBase = `/projects/${encodeURIComponent(selectedProject.id)}`;
  const projectApiBase = `/api/v1/projects/${encodeURIComponent(selectedProject.id)}`;

  const showInstallation = (
    result: AgentInstallationResponse,
    agentName: string,
    operation: "created" | "rotated"
  ) => {
    setInstallation(result);
    setInstallationProjectName(selectedProject.name);
    setInstallationAgentName(agentName);
    setInstallationOperation(operation);
    setInstallationExitStep(0);
    showToast({
      tone: "success",
      message: operation === "rotated"
        ? "Access secret rotated. Install the replacement script."
        : "Agent registered. Save the generated script."
    });
    agents.reload();
    reloadProjects();
  };

  const prepareAgentScript = (values: AgentEditableInput) => {
    setPendingRegistration(values);
    setRegistrationChecks({ ...DEFAULT_AGENT_CHECKS });
    setRegistrationStep("script");
    setRegistrationHealthUrl("");
    setError(null);
  };

  const createAgent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pendingRegistration) return;
    const validation = generateAgentScriptBodySchema.safeParse({ health_api_url: registrationChecks.middleware_api ? registrationHealthUrl : null, checks: registrationChecks });
    if (!validation.success) {
      const message = "Enter a valid Middleware API URL before generating the script.";
      setError(message);
      showToast({ tone: "error", message });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch<AgentInstallationResponse>(
        `${projectApiBase}/agent-installations`,
        {
          method: "POST",
          body: JSON.stringify({
            server_name: pendingRegistration.server_name,
            health_api_url: validation.data.health_api_url,
            checks: validation.data.checks,
            ram_available_threshold_percent: pendingRegistration.ram_available_threshold_percent,
            disk_available_threshold_percent: pendingRegistration.disk_available_threshold_percent,
            load_5_per_core_threshold: pendingRegistration.load_5_per_core_threshold,
            heartbeat_interval_seconds: pendingRegistration.heartbeat_interval_seconds,
            telegram_alert_cooldown_seconds: pendingRegistration.telegram_alert_cooldown_seconds,
            middleware_failure_threshold: pendingRegistration.middleware_failure_threshold
          })
        }
      );
      showInstallation(result, pendingRegistration.server_name, "created");
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : "The agent installation could not be generated.";
      setError(message);
      showToast({ tone: "error", message });
    } finally {
      setSubmitting(false);
    }
  };

  const rotateAgentCredential = async () => {
    if (!agentPendingRotation) return;
    const validation = generateAgentScriptBodySchema.safeParse({ health_api_url: rotationChecks.middleware_api ? rotationHealthUrl : null, checks: rotationChecks });
    if (!validation.success) {
      const message = "Enter a valid Middleware API URL before generating the replacement script.";
      setError(message);
      showToast({ tone: "error", message });
      return;
    }
    setRotating(true);
    setError(null);
    try {
      const result = await apiFetch<AgentInstallationResponse>(
        `${projectApiBase}/agents/${encodeURIComponent(agentPendingRotation.id)}/credential-rotation`,
        { method: "POST", body: JSON.stringify(validation.data) }
      );
      rotateTriggerRef.current = null;
      setAgentPendingRotation(null);
      setRotationHealthUrl("");
      showInstallation(result, agentPendingRotation.server_name, "rotated");
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : "The access secret could not be rotated.";
      setError(message);
      showToast({ tone: "error", message });
    } finally {
      setRotating(false);
    }
  };

  const updateAgent = async (values: AgentEditableInput) => {
    if (!editingAgent) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch<void>(
        `${projectApiBase}/agents/${encodeURIComponent(editingAgent.id)}`,
        { method: "PUT", body: JSON.stringify(values) }
      );
      setEditingAgent(null);
      agents.reload();
      reloadProjects();
      showToast({ tone: "success", message: "Agent settings saved. Access secret unchanged." });
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : "The agent could not be updated.";
      setError(message);
      showToast({ tone: "error", message });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteAgent = async () => {
    if (!agentPendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch<void>(
        `${projectApiBase}/agents/${encodeURIComponent(agentPendingDelete.id)}`,
        { method: "DELETE" }
      );
      deleteTriggerRef.current = null;
      setAgentPendingDelete(null);
      agents.reload();
      reloadProjects();
      showToast({ tone: "success", message: "Agent deleted. Access revoked." });
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : "The agent could not be deleted.";
      setDeleteError(message);
      showToast({ tone: "error", message });
    } finally {
      setDeleting(false);
    }
  };

  const download = () => {
    if (!installation) return;
    const url = URL.createObjectURL(new Blob([installation.script], { type: "text/x-shellscript" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = installation.script_filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const returnToOverview = () => {
    setInstallation(null);
    setInstallationProjectName(null);
    setInstallationAgentName(null);
    setInstallationOperation(null);
    setInstallationExitStep(0);
    setRegistrationOpen(false);
    setEditingAgent(null);
    setError(null);
  };

  if (installation) {
    const rotated = installationOperation === "rotated";
    return (
      <div className="page-stack">
        <button
          ref={installationBackButtonRef}
          className="back-link"
          type="button"
          aria-haspopup="dialog"
          aria-controls="leave-access-secret"
          onClick={() => setInstallationExitStep(1)}
        >
          <ArrowLeft aria-hidden="true" />
          Back To Overview
        </button>
        <header className="page-header">
          <div>
            <p className="page-context">{installationProjectName ?? selectedProject.name}</p>
            <h1>{rotated ? "Access Secret Rotated" : "Agent Registered"}</h1>
            <p>
              {installationAgentName ?? "This agent"} belongs to {installationProjectName ?? selectedProject.name}.
              {rotated
                ? " Install the replacement script now; the previous credential no longer works."
                : " Save its one-time script before leaving this page."}
            </p>
          </div>
          <KeyRound aria-hidden="true" />
        </header>
        <section className="form-banner form-banner--warning" role="status">
          {rotated ? "The previous access secret is revoked. " : "The access secret is shown only in this response. "}
          Save the script now and protect it with <code>chmod 700</code>.
        </section>
        <ol className="installation-steps">
          <li><span>1</span><div><h2>{rotated ? "Save The Replacement" : "Save One File"}</h2><p>Copy or download the generated shell script.</p></div></li>
          <li><span>2</span><div><h2>{rotated ? "Replace And Test" : "Run It Once"}</h2><p>Protect it with <code>chmod 700</code>, then verify one heartbeat manually.</p></div></li>
          <li><span>3</span><div><h2>{rotated ? "Replace Cron" : "Add Cron"}</h2><p>Use the exact crontab entry shown below.</p></div></li>
        </ol>
        <section className="code-surface">
          <div className="code-surface__header">
            <div><TerminalSquare aria-hidden="true" /><strong>{installation.script_filename}</strong></div>
            <div className="action-row">
              <CopyButton value={installation.script} label="Copy Script" />
              <button className="button button--secondary" type="button" onClick={download}>
                <Download aria-hidden="true" />
                Download .sh
              </button>
            </div>
          </div>
          <pre tabIndex={0}><code>{installation.script}</code></pre>
        </section>
        <section className="code-surface code-surface--compact">
          <div className="code-surface__header">
            <strong>Crontab Entry</strong>
            <CopyButton value={installation.crontab_entry} label="Copy Crontab" />
          </div>
          <pre tabIndex={0}><code>{installation.crontab_entry}</code></pre>
        </section>
        <ModalDialog
          id="leave-access-secret"
          open={installationExitStep > 0}
          labelledBy="leave-access-secret-title"
          describedBy="leave-access-secret-description"
          surfaceClassName="agent-dialog__surface agent-rotation-confirmation"
          restoreFocusTo={installationBackButtonRef.current}
        >
          <>
            <div>
              <ShieldAlert aria-hidden="true" />
              <div>
                <h2 id="leave-access-secret-title">
                  {installationExitStep === 1
                    ? "Leave the Access Secret Page?"
                    : "Confirm Leaving the Access Secret Page"}
                </h2>
                <p id="leave-access-secret-description">
                  {installationExitStep === 1
                    ? "Once you close this page, you cannot open this access secret or generated script again. Save both before continuing."
                    : "Final confirmation: this one-time access secret and generated script cannot be reopened. You must rotate the agent access secret to generate a replacement."}
                </p>
              </div>
              <button
                data-dialog-initial-focus={installationExitStep === 1 ? true : undefined}
                className="icon-button"
                type="button"
                aria-label="Close Leave Confirmation"
                onClick={() => setInstallationExitStep(0)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="action-row">
              {installationExitStep === 1 ? (
                <button className="button button--danger" type="button" onClick={() => setInstallationExitStep(2)}>
                  I Saved The Script — Continue
                </button>
              ) : (
                <button
                  ref={installationExitActionRef}
                  className="button button--danger"
                  type="button"
                  onClick={returnToOverview}
                >
                  Close Page And Return To Overview
                </button>
              )}
            </div>
          </>
        </ModalDialog>
      </div>
    );
  }

  const registeredAgents = agents.data ?? [];

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-context">Selected Project · {selectedProject.name}</p>
          <h1>Operations Overview</h1>
          <p>Monitor server health and manage every agent registered to this project.</p>
        </div>
        <button
          hidden={!hasPermission(user, "edit_agent_settings")}
          ref={registrationButtonRef}
          className="button button--primary"
          type="button"
          aria-haspopup="dialog"
          aria-controls="register-agent"
          onClick={() => {
            setRegistrationOpen(true);
            setRegistrationStep("settings");
            setPendingRegistration(null);
            setRegistrationHealthUrl("");
            setEditingAgent(null);
            setAgentPendingRotation(null);
            setAgentPendingDelete(null);
            setError(null);
            setDeleteError(null);
          }}
        >
          <Plus aria-hidden="true" />
          Register Agent
        </button>
      </header>

      <ProjectActions key={selectedProject.id} project={selectedProject} />

      <ModalDialog
        id="register-agent"
        open={registrationOpen && hasPermission(user, "edit_agent_settings")}
        labelledBy="register-agent-title"
        dialogClassName={registrationStep === "settings" ? "agent-dialog--agent-form" : undefined}
        surfaceClassName="agent-dialog__surface form-surface"
        restoreFocusTo={registrationButtonRef.current}
      >
        <div className="section-heading">
          <div>
            <h2 id="register-agent-title">
              {registrationStep === "settings" ? "Register Agent" : "Generate Agent Script"}
            </h2>
            <p>
              {registrationStep === "settings"
                ? `The new agent will belong to ${selectedProject.name}.`
                : "Step 1 of 1. Enter the health endpoint that this generated script will check."}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={registrationStep === "settings" ? "Close Registration" : "Close Script Generation"}
            disabled={submitting}
            onClick={() => {
              setRegistrationOpen(false);
              setRegistrationStep("settings");
              setPendingRegistration(null);
              setRegistrationHealthUrl("");
              setError(null);
            }}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        {registrationStep === "settings" ? (
          <AgentForm
            key="create-agent"
            submitting={false}
            submitLabel="Continue To Script Generation"
            submittingLabel="Continuing"
            error={error}
            onSubmit={prepareAgentScript}
          />
        ) : (
          <>
            {error ? <div className="form-banner form-banner--error" role="alert">{error}</div> : null}
            <form className="form-grid" onSubmit={(event) => void createAgent(event)} noValidate aria-busy={submitting}>
              <AgentScriptChecks value={registrationChecks} onChange={setRegistrationChecks} disabled={submitting} />
              {registrationChecks.middleware_api ? <div className="field field--wide">
                <label htmlFor="registration-health-api-url">Middleware API URL</label>
                <input
                  ref={registrationHealthUrlRef}
                  id="registration-health-api-url"
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  value={registrationHealthUrl}
                  onChange={(event) => {
                    setRegistrationHealthUrl(event.target.value);
                    setError(null);
                  }}
                  placeholder="http://127.0.0.1:3000/health"
                  required
                />
                <span className="field__help">Saved as the middleware endpoint used by this generated script.</span>
              </div> : null}
              <button className="button button--primary field--wide" type="submit" disabled={submitting}>
                {submitting ? <InlineLoader label="Generating Script" /> : "Generate Script"}
              </button>
            </form>
          </>
        )}
      </ModalDialog>

      <ModalDialog
        id="edit-agent"
        open={Boolean(editingAgent) && hasPermission(user, "edit_agent_settings")}
        labelledBy="edit-agent-title"
        dialogClassName="agent-dialog--agent-form"
        surfaceClassName="agent-dialog__surface form-surface"
        restoreFocusTo={editTriggerRef.current}
      >
        {editingAgent ? (
          <>
            <div className="section-heading">
              <div>
                <h2 id="edit-agent-title">Edit {editingAgent.server_name}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close Edit Form"
                disabled={submitting}
                onClick={() => {
                  setEditingAgent(null);
                  setError(null);
                }}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <AgentForm
              key={editingAgent.id}
              initialValues={{
                server_name: editingAgent.server_name,
                ram_available_threshold_percent: editingAgent.ram_available_threshold_percent,
                disk_available_threshold_percent: editingAgent.disk_available_threshold_percent,
                load_5_per_core_threshold: editingAgent.load_5_per_core_threshold,
                heartbeat_interval_seconds: editingAgent.heartbeat_interval_seconds,
                telegram_alert_cooldown_seconds: editingAgent.telegram_alert_cooldown_seconds,
                middleware_failure_threshold: editingAgent.middleware_failure_threshold ?? 2
              }}
              submitting={submitting}
              submitLabel="Save Changes"
              submittingLabel="Saving Changes"
              error={error}
              onSubmit={(values) => void updateAgent(values)}
            />
          </>
        ) : null}
      </ModalDialog>

      <ModalDialog
        id="rotate-agent-credential"
        open={Boolean(agentPendingRotation) && hasPermission(user, "rotate_agent_secrets")}
        labelledBy="rotate-agent-credential-title"
        describedBy="rotate-agent-credential-description"
        surfaceClassName="agent-dialog__surface agent-rotation-confirmation"
        restoreFocusTo={rotateTriggerRef.current ?? registrationButtonRef.current}
      >
        {agentPendingRotation ? (
          <>
            <div>
              <KeyRound aria-hidden="true" />
              <div>
                <h2 id="rotate-agent-credential-title">Rotate Access Secret For {agentPendingRotation.server_name}?</h2>
                <p id="rotate-agent-credential-description">Choose checks for the replacement script. The current script will stop authenticating immediately.</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close Access Secret Rotation"
                disabled={rotating}
                onClick={() => {
                  setAgentPendingRotation(null);
                  setRotationHealthUrl("");
                  setError(null);
                }}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <AgentScriptChecks value={rotationChecks} onChange={setRotationChecks} disabled={rotating} />
            {rotationChecks.middleware_api ? <div className="field">
              <label htmlFor="rotation-health-api-url">Middleware API URL</label>
              <input
                id="rotation-health-api-url"
                data-dialog-initial-focus
                type="url"
                inputMode="url"
                spellCheck={false}
                value={rotationHealthUrl}
                onChange={(event) => {
                  setRotationHealthUrl(event.target.value);
                  setError(null);
                }}
                required
              />
              <span className="field__help">Prefilled from the latest generated script. Change it only when the replacement script should use another endpoint.</span>
            </div> : null}
            {error ? <p className="field__help field__help--error" role="alert">{error}</p> : null}
            <div className="action-row">
              <button className="button button--danger" type="button" disabled={rotating} onClick={() => void rotateAgentCredential()}>
                {rotating ? <InlineLoader label="Rotating Access Secret" /> : "Rotate And Generate Script"}
              </button>
            </div>
          </>
        ) : null}
      </ModalDialog>

      <ModalDialog
        id="delete-agent"
        open={Boolean(agentPendingDelete) && hasPermission(user, "delete_agents")}
        labelledBy="delete-agent-title"
        describedBy="delete-agent-description"
        surfaceClassName="agent-dialog__surface agent-delete-confirmation"
        restoreFocusTo={deleteTriggerRef.current ?? registrationButtonRef.current}
      >
        {agentPendingDelete ? (
          <>
            <div>
              <ShieldAlert aria-hidden="true" />
              <div>
                <h2 id="delete-agent-title">Delete {agentPendingDelete.server_name}?</h2>
                <p id="delete-agent-description">Its access secret will stop working immediately. Historical records remain retained.</p>
              </div>
              <button
                data-dialog-initial-focus
                className="icon-button"
                type="button"
                aria-label="Close Deletion Confirmation"
                disabled={deleting}
                onClick={() => {
                  setAgentPendingDelete(null);
                  setDeleteError(null);
                }}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            {deleteError ? <p className="field__help field__help--error" role="alert">{deleteError}</p> : null}
            <div className="action-row">
              <button className="button button--danger" type="button" disabled={deleting} onClick={() => void deleteAgent()}>
                {deleting ? <InlineLoader label="Deleting Agent" /> : "Delete Agent"}
              </button>
            </div>
          </>
        ) : null}
      </ModalDialog>

      {agents.status === "loading" ? <PageSkeleton rows={4} /> : null}
      {agents.status === "error" ? (
        <ErrorState
          title="Couldn't Load Registered Agents"
          message={agents.error?.message ?? "Check the central API and try again."}
          onRetry={agents.reload}
        />
      ) : null}
      {agents.status === "success" && registeredAgents.length === 0 ? (
        <EmptyState
          title="No Registered Agents"
          message="Register the first server to begin monitoring this project."
          action={
            <button
              className="button button--primary"
              type="button"
              onClick={(event) => {
                registrationButtonRef.current = event.currentTarget;
                setRegistrationOpen(true);
                setRegistrationStep("settings");
                setPendingRegistration(null);
                setRegistrationHealthUrl("");
                setError(null);
              }}
            >
              <Plus aria-hidden="true" />
              Register First Agent
            </button>
          }
        />
      ) : null}
      {agents.status === "success" && registeredAgents.length > 0 ? (
        <section className="data-surface" aria-labelledby="registered-agents-title">
          <div className="section-heading">
            <div>
              <h2 id="registered-agents-title">Registered Agents</h2>
              <p>Unhealthy and stale agents are listed first.</p>
            </div>
            <span className="numeric section-count">
              Total {formatCount(registeredAgents.length)} {registeredAgents.length === 1 ? "Agent" : "Agents"}
            </span>
          </div>
          <div className="table-wrap">
            <table className="data-table agent-roster-table">
              <caption className="visually-hidden">
                Current health, resource usage, and management actions for registered agents.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Agent Name</th>
                  <th scope="col">Resource Use</th>
                  <th scope="col">Server State</th>
                  <th scope="col">Last Heartbeat</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {registeredAgents.map((agent) => (
                  <tr key={agent.id}>
                    <th scope="row" data-label="Agent Name" className="server-cell">
                      <strong>{agent.server_name}</strong>
                      <small>{agent.agent_version ? `Agent ${agent.agent_version}` : "Version Pending"}</small>
                    </th>
                    <td data-label="Resource Use">
                      <div className="resource-stack numeric">
                        <span>
                          <small>RAM</small>
                          <MetricValue value={utilizationFromAvailable(agent.ram_available_percent)} format={formatPercent} />
                        </span>
                        <span>
                          <small>Storage</small>
                          <MetricValue value={utilizationFromAvailable(agent.disk_available_percent)} format={formatPercent} />
                        </span>
                        <span>
                          <small>Load Average (5 Min)</small>
                          <MetricValue value={agent.latest_load_5} format={formatLoadAverage} />
                        </span>
                      </div>
                    </td>
                    <td data-label="Server State">
                      <AgentStateDisplay status={agent.status} probableCause={agent.probable_cause} />
                    </td>
                    <td
                      data-label="Last Heartbeat"
                      className="agent-heartbeat-cell"
                      title={agent.last_heartbeat_at ? new Date(agent.last_heartbeat_at).toISOString() : undefined}
                    >
                      <AgentHeartbeatStatus agent={agent} />
                    </td>
                    <td className="row-action">
                      <div className="agent-row-actions">
                        <Link
                          className="icon-button"
                          aria-label={`View Agent Detail For ${agent.server_name}`}
                          title="View Agent Detail"
                          to={`${projectBase}/agents/${encodeURIComponent(agent.id)}`}
                        >
                          <ArrowRight aria-hidden="true" />
                        </Link>
                        <button
                          className="icon-button"
                          type="button"
                          hidden={!hasPermission(user, "edit_agent_settings")}
                          aria-label={`Edit ${agent.server_name}`}
                          title="Edit Agent"
                          aria-haspopup="dialog"
                          aria-controls="edit-agent"
                          onClick={(event) => {
                            editTriggerRef.current = event.currentTarget;
                            setRegistrationOpen(false);
                            setAgentPendingRotation(null);
                            setAgentPendingDelete(null);
                            setEditingAgent(agent);
                            setError(null);
                          }}
                        >
                          <Pencil aria-hidden="true" />
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          hidden={!hasPermission(user, "rotate_agent_secrets")}
                          aria-label={`Rotate ${agent.server_name} Access Secret`}
                          title="Rotate Access Secret"
                          aria-haspopup="dialog"
                          aria-controls="rotate-agent-credential"
                          onClick={(event) => {
                            rotateTriggerRef.current = event.currentTarget;
                            setRegistrationOpen(false);
                            setEditingAgent(null);
                            setAgentPendingDelete(null);
                            setAgentPendingRotation(agent);
                            setRotationHealthUrl(agent.health_api_url ?? "");
                            setRotationChecks(agent.checks ?? { ...DEFAULT_AGENT_CHECKS });
                            setError(null);
                          }}
                        >
                          <KeyRound aria-hidden="true" />
                        </button>
                        <button
                          className="icon-button icon-button--danger"
                          type="button"
                          hidden={!hasPermission(user, "delete_agents")}
                          aria-label={`Delete ${agent.server_name}`}
                          title="Delete Agent"
                          aria-haspopup="dialog"
                          aria-controls="delete-agent"
                          onClick={(event) => {
                            deleteTriggerRef.current = event.currentTarget;
                            setRegistrationOpen(false);
                            setEditingAgent(null);
                            setAgentPendingRotation(null);
                            setAgentPendingDelete(agent);
                            setDeleteError(null);
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
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
