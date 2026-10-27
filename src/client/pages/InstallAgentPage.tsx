import { hasPermission } from "../../shared/permissions";
import { ArrowLeft, Eye, KeyRound, Pencil, Plus, Search, Server, ShieldAlert, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
import { agentStateCause } from "../components/AgentStateDisplay";
import { StatusBadge } from "../components/StatusBadge";
import { AgentRosterChecks } from "../components/AgentRosterChecks";
import { AgentActionsMenu } from "../components/AgentActionsMenu";
import { formatServerUptime } from "../../shared/uptime";
import { AgentScriptSetup } from "../components/AgentScriptSetup";
import { EmptyState, ErrorState, InlineLoader, PageSkeleton } from "../components/Feedback";
import { ModalDialog } from "../components/ModalDialog";
import { MaintenanceControl } from "../components/MaintenanceControl";
import { BulkHealthChecksButton } from "../components/BulkHealthChecks";
import { WizardSteps } from "../components/WizardSteps";
import { MaintenanceIcon } from "../components/MaintenanceIcon";
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
  const uptimeStale = agent.uptime_received_at != null
    && Date.now() >= agent.uptime_received_at + agent.heartbeat_interval_seconds * 1000;

  const live = agent.last_heartbeat_at !== null && !heartbeatOverdue && agent.status !== "stale" && agent.status !== "new";

  return (
    <div className="agent-report-stack">
      <div className="agent-heartbeat"><small>Last Heartbeat</small>
        <span className="roster-heartbeat-value"><span className={`live-dot live-dot--${live ? "live" : "idle"}`} aria-hidden="true" /><span className="numeric">{formatRelativeTime(agent.last_heartbeat_at)}</span>
          {heartbeatOverdue ? <span className="roster-overdue"><TriangleAlert aria-hidden="true" />Overdue</span> : null}
        </span>
      </div>
      <div><small>{uptimeStale ? "Last Reported Uptime" : "Server Uptime"}</small>
        <span className="numeric">{formatServerUptime(agent.uptime_seconds ?? null)}</span></div>
    </div>
  );
}

function AgentRosterResources({ agent }: { agent: AgentSummary }) {
  const stale = agent.last_metrics_at !== null && (agent.status === "stale"
    || Date.now() >= agent.last_metrics_at + agent.heartbeat_interval_seconds * 1000);
  const metrics = [
    { label: "RAM", value: utilizationFromAvailable(agent.ram_available_percent), capacity: true },
    { label: "Root Disk", value: utilizationFromAvailable(agent.disk_available_percent), capacity: true },
    { label: "Load/Core", value: agent.load_5_per_core, capacity: false }
  ];
  return <div className={`roster-resources${stale ? " roster-resources--stale" : ""}`}>
    {metrics.map(metric => <div className="roster-resource" key={metric.label}>
      <div><span>{metric.label}</span><MetricValue value={metric.value} format={metric.capacity ? formatPercent : formatLoadAverage} /></div>
      {metric.capacity ? metric.value === null ? <span className="roster-resource__empty" aria-hidden="true" />
        : <progress max={100} value={Math.min(100, Math.max(0, metric.value))} aria-label={`${metric.label} Usage For ${agent.server_name}`}
          data-level={metric.value >= 90 ? "critical" : metric.value >= 70 ? "warning" : "normal"} /> : null}
    </div>)}
    {stale ? <span className="roster-resource-freshness">Last Reported · Stale</span> : null}
  </div>;
}

/** Register Agent guided flow; the agent form owns steps 1–3, this page owns step 4 (checks + script). */
const REGISTRATION_STEPS = [
  { title: "Server", hint: "Name the agent" },
  { title: "Thresholds", hint: "Usage that alerts" },
  { title: "Alert Timing", hint: "When to alert" },
  { title: "Health Checks", hint: "Pick checks, get script" }
] as const;

export function InstallAgentPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
    if (!installation) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [installation]);

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
    setRegistrationOpen(false);
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
            telegram_recovery_cooldown_seconds: pendingRegistration.telegram_recovery_cooldown_seconds,
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

  // The one-time script dialogs sit on top of the normal overview, so the roster stays visible behind them.
  const rotated = installationOperation === "rotated";
  const installationDialogs = installation ? <>
        <ModalDialog id="agent-script-setup" open labelledBy="agent-script-setup-title" describedBy="agent-script-setup-description"
          dialogClassName="agent-dialog--script-setup" surfaceClassName="agent-dialog__surface agent-setup-surface"
          restoreFocusTo={registrationButtonRef.current} onDismiss={() => setInstallationExitStep(1)}>
          <div className="agent-setup-dialog-heading">
            <div><h2 id="agent-script-setup-title">{rotated ? "Access Secret Rotated" : "Agent Registered"}</h2>
              <p className="agent-setup-context">{installationAgentName ?? "This Agent"} · {installationProjectName ?? selectedProject.name}</p>
              <p id="agent-script-setup-description">{rotated ? "The old secret is revoked. Save this replacement before closing; it cannot be retrieved again." : "Save this one-time script before closing; it cannot be retrieved again."}</p></div>
            <button ref={installationBackButtonRef} data-dialog-initial-focus className="icon-button" type="button" aria-label="Close Agent Setup" onClick={() => setInstallationExitStep(1)}><X aria-hidden="true" /></button>
          </div>
          <AgentScriptSetup key={installation.agent_id} installation={installation} compact={rotated} onDone={returnToOverview} />
        </ModalDialog>
        <ModalDialog
          id="leave-access-secret"
          open={installationExitStep > 0}
          labelledBy="leave-access-secret-title"
          describedBy="leave-access-secret-description"
          surfaceClassName="agent-dialog__surface form-surface agent-delete-dialog"
          restoreFocusTo={installationBackButtonRef.current}
        >
          <>
            <div className="section-heading">
              <div>
                <h2 id="leave-access-secret-title">
                  {installationExitStep === 1
                    ? "Leave the Access Secret Page?"
                    : "Confirm Leaving the Access Secret Page"}
                </h2>
                <p>{installationAgentName ?? "This Agent"} · {installationProjectName ?? selectedProject.name}</p>
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
            <div className="form-banner form-banner--warning agent-delete-dialog__notice">
              <ShieldAlert aria-hidden="true" />
              <p id="leave-access-secret-description">
                {installationExitStep === 1
                  ? "Once you close this page, you cannot open this access secret or generated script again. Save both before continuing."
                  : "Final confirmation: this one-time access secret and generated script cannot be reopened. You must rotate the agent access secret to generate a replacement."}
              </p>
            </div>
            <div className="action-row">
              <button className="button button--secondary" type="button" onClick={() => setInstallationExitStep(0)}>
                Back To Script
              </button>
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
  </> : null;

  const registeredAgents = agents.data ?? [];
  const rosterSearch = searchParams.get("agent_search") ?? "";
  const rosterFilter = searchParams.get("agent_filter") ?? "all";
  const visibleAgents = registeredAgents.filter(agent =>
    agent.server_name.toLocaleLowerCase().includes(rosterSearch.trim().toLocaleLowerCase())
    && (rosterFilter === "attention" ? agent.status !== "healthy" : rosterFilter === "healthy" ? agent.status === "healthy" : true));
  const setRosterQuery = (key: "agent_search" | "agent_filter", value: string) => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    if (value && !(key === "agent_filter" && value === "all")) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });
  const clearRosterFilters = () => setSearchParams(previous => {
    const next = new URLSearchParams(previous); next.delete("agent_search"); next.delete("agent_filter"); return next;
  }, { replace: true });

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <nav className="page-breadcrumb" aria-label="Breadcrumb">
            <ol>
              <li>{hasPermission(user, "view_projects") ? <Link to="/projects">Projects</Link> : "Projects"}</li>
              <li aria-current="page">{selectedProject.name}</li>
            </ol>
          </nav>
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

      <ProjectActions key={selectedProject.id} project={selectedProject}>
        <MaintenanceControl endpoint={`${projectApiBase}/maintenance`} scope="Project" detailsTargetId="project-maintenance-details"
          canManage={hasPermission(user, "edit_project_settings")} onChanged={agents.reload} />
        {hasPermission(user, "edit_agent_settings") && agents.data?.length ? <BulkHealthChecksButton projectApiBase={projectApiBase}
          projectName={selectedProject.name} agents={agents.data} onSaved={agents.reload} /> : null}
      </ProjectActions>
      <div id="project-maintenance-details" className="maintenance-details-slot" />

      <ModalDialog
        id="register-agent"
        open={registrationOpen && hasPermission(user, "edit_agent_settings")}
        labelledBy="register-agent-title"
        dialogClassName="agent-dialog--agent-form"
        surfaceClassName="agent-dialog__surface form-surface"
        restoreFocusTo={registrationButtonRef.current}
      >
        <div className="section-heading">
          <div>
            <h2 id="register-agent-title">Register Agent</h2>
            <p>The new agent will belong to {selectedProject.name}.</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close Registration"
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
            initialValues={pendingRegistration ?? undefined}
            wizard={{ steps: REGISTRATION_STEPS, initialStep: pendingRegistration ? 2 : 0 }}
            submitting={false}
            submitLabel="Next: Health Checks"
            submittingLabel="Continuing"
            error={error}
            onSubmit={prepareAgentScript}
          />
        ) : (
          <>
            {error ? <div className="form-banner form-banner--error" role="alert">{error}</div> : null}
            <form className="form-grid agent-settings-form agent-settings-form--wizard" onSubmit={(event) => void createAgent(event)} noValidate aria-busy={submitting}>
              <WizardSteps steps={REGISTRATION_STEPS} current={3} label="Agent Registration Progress" />
              <AgentScriptChecks value={registrationChecks} onChange={setRegistrationChecks} disabled={submitting}
                help="Unchecked services are not monitored. These choices go into the generated script." />
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
              <div className="agent-settings-actions agent-wizard-actions field--wide">
                <button className="button button--secondary" type="button" disabled={submitting}
                  onClick={() => { setError(null); setRegistrationStep("settings"); }}><ArrowLeft aria-hidden="true" />Back</button>
                <button className="button button--primary" type="submit" disabled={submitting}>
                  {submitting ? <InlineLoader label="Generating Script" /> : "Generate Script"}
                </button>
              </div>
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
                telegram_recovery_cooldown_seconds: editingAgent.telegram_recovery_cooldown_seconds,
                middleware_failure_threshold: editingAgent.middleware_failure_threshold ?? 2
              }}
              checks={{ initial: editingAgent.checks ?? { ...DEFAULT_AGENT_CHECKS }, middlewareUrlSaved: editingAgent.health_api_url !== null }}
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
        surfaceClassName="agent-dialog__surface form-surface agent-delete-dialog"
        restoreFocusTo={deleteTriggerRef.current ?? registrationButtonRef.current}
      >
        {agentPendingDelete ? (
          <>
            <div className="section-heading">
              <div>
                <h2 id="delete-agent-title">Delete {agentPendingDelete.server_name}?</h2>
                <p>Registered in {selectedProject.name}.</p>
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
            <div className="form-banner form-banner--error agent-delete-dialog__notice">
              <ShieldAlert aria-hidden="true" />
              <p id="delete-agent-description">Its access secret will stop working immediately. Historical records remain retained.</p>
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
        <section className="data-surface agent-roster-surface agent-roster-surface--inventory" aria-labelledby="registered-agents-title">
          <h2 id="registered-agents-title" className="visually-hidden">Registered Agents</h2>
          <div className="roster-toolbar">
            <div className="roster-filters" role="group" aria-label="Filter Agents By Health">
              {[
                { key: "all", label: "All", accessible: "All Agents", count: registeredAgents.length },
                { key: "attention", label: "Attention", accessible: "Agents Needing Attention", count: registeredAgents.filter(agent => agent.status !== "healthy").length },
                { key: "healthy", label: "Healthy", accessible: "Healthy Agents", count: registeredAgents.filter(agent => agent.status === "healthy").length }
              ].map(filter => <button key={filter.key} type="button"
                aria-label={`${filter.accessible} (${filter.count})`}
                aria-pressed={filter.key === (rosterFilter === "attention" || rosterFilter === "healthy" ? rosterFilter : "all")}
                onClick={() => setRosterQuery("agent_filter", filter.key)}>
                {filter.label}<span className="numeric">{formatCount(filter.count)}</span>
              </button>)}
            </div>
            <label className="roster-search"><Search aria-hidden="true" /><span className="visually-hidden">Search Agents</span>
              <input type="search" placeholder="Search Agents" value={rosterSearch} maxLength={120}
                onChange={event => setRosterQuery("agent_search", event.target.value)} />
            </label>
          </div>
          <div className="table-wrap">
            <table className="data-table agent-roster-table">
              <caption className="visually-hidden">
                Current status, resource usage, health checks, reported server uptime, heartbeat freshness, and management actions for registered agents.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Agent Name</th>
                  <th scope="col">Resource Use</th>
                  <th scope="col">Health Checks</th>
                  <th scope="col">Activity</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleAgents.map((agent) => (
                  <tr key={agent.id} className="agent-roster-row" onClick={event => {
                    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
                      || (event.target as Element).closest("a, button, input, select, textarea, summary, [popover]")
                      || window.getSelection()?.toString()) return;
                    navigate(`${projectBase}/agents/${encodeURIComponent(agent.id)}`);
                  }}>
                    <th scope="row" data-label="Agent Name" className="server-cell">
                      <div className="roster-identity-row">
                      <span className={`status-tile status-tile--${agent.status}`} aria-hidden="true"><Server /></span>
                      <div className="roster-identity">
                        <span className="entity-name"><Link className="roster-agent-link" title="View Agent Detail"
                          aria-label={`View Agent Detail For ${agent.server_name}`} to={`${projectBase}/agents/${encodeURIComponent(agent.id)}`}>
                          <strong>{agent.server_name}</strong></Link><MaintenanceIcon maintenance={agent.maintenance} /></span>
                        <div className="roster-identity__meta"><StatusBadge status={agent.status} />
                          <span>{agent.agent_version ? `v${agent.agent_version}` : "Version Pending"}</span></div>
                        {agentStateCause(agent.status, agent.probable_cause) ? <p className="roster-identity__cause">{agentStateCause(agent.status, agent.probable_cause)}</p> : null}
                      </div>
                      </div>
                    </th>
                    <td data-label="Resource Use">
                      <AgentRosterResources agent={agent} />
                    </td>
                    <td data-label="Health Checks">
                      <AgentRosterChecks agent={agent} />
                    </td>
                    <td
                      data-label="Activity"
                      className="agent-heartbeat-cell"
                      title={agent.last_heartbeat_at ? new Date(agent.last_heartbeat_at).toISOString() : undefined}
                    >
                      <AgentHeartbeatStatus agent={agent} />
                    </td>
                    <td className="row-action">
                      <div className="agent-row-actions">
                        <AgentActionsMenu name={agent.server_name}>
                        <Link className="button button--secondary" aria-label={`View ${agent.server_name}`}
                          to={`${projectBase}/agents/${encodeURIComponent(agent.id)}`}>
                          <Eye aria-hidden="true" /> View
                        </Link>
                        <button
                          className="button button--secondary"
                          type="button"
                          hidden={!hasPermission(user, "edit_agent_settings")}
                          aria-label={`Edit ${agent.server_name}`}
                          title="Edit Agent"
                          aria-haspopup="dialog"
                          aria-controls="edit-agent"
                          onClick={(event) => {
                            editTriggerRef.current = event.currentTarget.closest("tr")?.querySelector<HTMLButtonElement>("[data-agent-actions]") ?? event.currentTarget;
                            setRegistrationOpen(false);
                            setAgentPendingRotation(null);
                            setAgentPendingDelete(null);
                            setEditingAgent(agent);
                            setError(null);
                          }}
                        >
                          <Pencil aria-hidden="true" /> Edit
                        </button>
                        <button
                          className="button button--secondary"
                          type="button"
                          hidden={!hasPermission(user, "rotate_agent_secrets")}
                          aria-label={`Rotate ${agent.server_name} Access Secret`}
                          title="Rotate Access Secret"
                          aria-haspopup="dialog"
                          aria-controls="rotate-agent-credential"
                          onClick={(event) => {
                            rotateTriggerRef.current = event.currentTarget.closest("tr")?.querySelector<HTMLButtonElement>("[data-agent-actions]") ?? event.currentTarget;
                            setRegistrationOpen(false);
                            setEditingAgent(null);
                            setAgentPendingDelete(null);
                            setAgentPendingRotation(agent);
                            setRotationHealthUrl(agent.health_api_url ?? "");
                            setRotationChecks(agent.checks ?? { ...DEFAULT_AGENT_CHECKS });
                            setError(null);
                          }}
                        >
                          <KeyRound aria-hidden="true" /> Rotate Secret
                        </button>
                        <button
                          className="button button--secondary icon-button--danger"
                          type="button"
                          hidden={!hasPermission(user, "delete_agents")}
                          aria-label={`Delete ${agent.server_name}`}
                          title="Delete Agent"
                          aria-haspopup="dialog"
                          aria-controls="delete-agent"
                          onClick={(event) => {
                            deleteTriggerRef.current = event.currentTarget.closest("tr")?.querySelector<HTMLButtonElement>("[data-agent-actions]") ?? event.currentTarget;
                            setRegistrationOpen(false);
                            setEditingAgent(null);
                            setAgentPendingRotation(null);
                            setAgentPendingDelete(agent);
                            setDeleteError(null);
                          }}
                        >
                          <Trash2 aria-hidden="true" /> Delete
                        </button>
                        </AgentActionsMenu>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleAgents.length === 0 ? <tr className="roster-no-results"><td colSpan={5}>
                  <Search aria-hidden="true" /><strong>No Matching Agents</strong>
                  <p>Try another name or clear the health filter.</p>
                  <button className="button button--secondary" type="button" onClick={clearRosterFilters}>Clear Filters</button>
                </td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="roster-footer" role="status">
            <span>{formatCount(visibleAgents.length)} Of {formatCount(registeredAgents.length)} Agents</span>
            <span>Attention First</span>
          </div>
        </section>
      ) : null}
      {installationDialogs}
    </div>
  );
}
