import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, BellRing, Gauge, Save, ShieldCheck } from "lucide-react";
import {
  updateAgentBodySchema,
  DEFAULT_TELEGRAM_RECOVERY_COOLDOWN_SECONDS,
  type AgentChecks,
  type AgentEditableInput
} from "../../shared/contracts";
import { AgentScriptChecks } from "./AgentScriptChecks";
import { InlineLoader } from "./Feedback";
import { useToast } from "./ToastProvider";
import { WizardSteps, type WizardStep } from "./WizardSteps";
import { availableFromUtilization, utilizationFromAvailable } from "../lib/format";

type SettingsSection = "server" | "checks" | "resources" | "timing";

/** Validation issue path -> the tab (or wizard step) that holds the field, so a failed save opens the right section. */
const SECTION_BY_FIELD: Record<string, SettingsSection> = {
  server_name: "server", checks: "checks",
  ram_available_threshold_percent: "resources", disk_available_threshold_percent: "resources", load_5_per_core_threshold: "resources",
  heartbeat_interval_seconds: "timing", telegram_alert_cooldown_seconds: "timing",
  telegram_recovery_cooldown_seconds: "timing", middleware_failure_threshold: "timing"
};

interface AgentFormProps {
  initialValues?: Partial<AgentEditableInput>;
  submitting: boolean;
  submitLabel: string;
  submittingLabel: string;
  error: string | null;
  onSubmit: (values: AgentEditableInput) => void;
  /** Editing an installed agent: shows the check switches; Middleware API can only be turned on when a URL is saved. */
  checks?: { initial: AgentChecks; middlewareUrlSaved: boolean };
  /**
   * Guided layout: Server, Thresholds and Alert Timing become steps 1–3 of `steps` (later steps belong to the caller);
   * submitLabel names the button on the last of these three.
   */
  wizard?: { steps: readonly WizardStep[]; initialStep?: number };
}

const WIZARD_SECTIONS: SettingsSection[] = ["server", "resources", "timing"];
const STEP_MESSAGES: Record<SettingsSection, string> = {
  server: "Enter a server name.", checks: "Check the health check selection.",
  resources: "Check the RAM, storage, and load thresholds.", timing: "Check the alert timing values."
};

export function AgentForm({
  initialValues,
  submitting,
  submitLabel,
  submittingLabel,
  error,
  onSubmit,
  checks,
  wizard
}: AgentFormProps) {
  const { showToast } = useToast();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [serverName, setServerName] = useState(initialValues?.server_name ?? "");
  const [ramUtilization, setRamUtilization] = useState(
    String(utilizationFromAvailable(initialValues?.ram_available_threshold_percent) ?? 85)
  );
  const [storageUtilization, setStorageUtilization] = useState(
    String(utilizationFromAvailable(initialValues?.disk_available_threshold_percent) ?? 90)
  );
  const [cpuLoad, setCpuLoad] = useState(String(initialValues?.load_5_per_core_threshold ?? 1.5));
  const [heartbeatInterval, setHeartbeatInterval] = useState(
    String(initialValues?.heartbeat_interval_seconds ?? 120)
  );
  const [telegramCooldown, setTelegramCooldown] = useState(
    String(initialValues?.telegram_alert_cooldown_seconds ?? 900)
  );
  const [recoveryCooldown, setRecoveryCooldown] = useState(String(initialValues?.telegram_recovery_cooldown_seconds ?? DEFAULT_TELEGRAM_RECOVERY_COOLDOWN_SECONDS));
  const [middlewareFailureThreshold, setMiddlewareFailureThreshold] = useState(String(initialValues?.middleware_failure_threshold ?? 2));
  const [selectedChecks, setSelectedChecks] = useState<AgentChecks | null>(checks?.initial ?? null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [section, setSection] = useState<SettingsSection>(checks ? "checks" : "resources");
  const [wizardStep, setWizardStep] = useState(wizard?.initialStep ?? 0);
  const formRef = useRef<HTMLFormElement>(null);
  const isActive = (key: SettingsSection) => wizard ? WIZARD_SECTIONS[wizardStep] === key : section === key;
  const sections = [
    ...(checks ? [{ key: "checks", label: "Health Checks", short: "Checks", icon: ShieldCheck }] as const : []),
    { key: "resources", label: "Resource Thresholds", short: "Resources", icon: Gauge },
    { key: "timing", label: "Alert Timing", short: "Timing", icon: BellRing }
  ] as const;

  function moveSection(event: KeyboardEvent<HTMLButtonElement>, current: SettingsSection) {
    const keys = sections.map((item) => item.key as SettingsSection);
    const index = keys.indexOf(current);
    const next = event.key === "ArrowRight" ? keys[(index + 1) % keys.length]
      : event.key === "ArrowLeft" ? keys[(index - 1 + keys.length) % keys.length]
      : event.key === "Home" ? keys[0] : event.key === "End" ? keys[keys.length - 1] : null;
    if (!next) return;
    event.preventDefault();
    setSection(next);
    document.getElementById(`agent-settings-tab-${next}`)?.focus();
  }

  useEffect(() => {
    if (!wizard) { nameInputRef.current?.focus(); return; }
    // Each step moves focus to its first field so keyboard and screen-reader users land in the new step.
    formRef.current?.querySelector<HTMLElement>('[data-active="true"] :is(input, select)')?.focus();
  }, [wizard, wizardStep]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const validation = parseValues();
    if (wizard && wizardStep < WIZARD_SECTIONS.length - 1) {
      const current = WIZARD_SECTIONS[wizardStep];
      const blocked = !validation.success && validation.error.issues.some((issue) => SECTION_BY_FIELD[String(issue.path[0])] === current);
      if (blocked) { setValidationError(STEP_MESSAGES[current]); return; }
      setValidationError(null);
      setWizardStep(wizardStep + 1);
      return;
    }
    if (!validation.success) {
      const invalid = validation.error.issues.map((issue) => SECTION_BY_FIELD[String(issue.path[0])]).find(Boolean);
      if (invalid && wizard) setWizardStep(WIZARD_SECTIONS.indexOf(invalid));
      else if (invalid && invalid !== "server") setSection(invalid);
      const message = wizard && invalid ? STEP_MESSAGES[invalid] : "Check the server details, utilization thresholds, missing-heartbeat timeout, and Telegram intervals.";
      setValidationError(message);
      showToast({ tone: "error", message });
      return;
    }
    setValidationError(null);
    onSubmit(validation.data);
  };

  function parseValues() {
    return updateAgentBodySchema.safeParse({
      server_name: serverName,
      ram_available_threshold_percent: availableFromUtilization(Number(ramUtilization)),
      disk_available_threshold_percent: availableFromUtilization(Number(storageUtilization)),
      load_5_per_core_threshold: Number(cpuLoad),
      heartbeat_interval_seconds: Number(heartbeatInterval),
      telegram_alert_cooldown_seconds: Number(telegramCooldown),
      telegram_recovery_cooldown_seconds: Number(recoveryCooldown),
      middleware_failure_threshold: Number(middlewareFailureThreshold),
      ...(selectedChecks ? { checks: selectedChecks } : {})
    });
  }

  const message = validationError ?? error;
  const serverDetails = (
    <fieldset className="form-section field--wide">
          <legend>Server Details</legend>
          <div className="form-section__grid">
            <div className="field">
            <label htmlFor="agent-server-name">Server Name</label>
              <input
                ref={nameInputRef}
                data-dialog-initial-focus
                id="agent-server-name"
                value={serverName}
                onChange={(event) => setServerName(event.target.value)}
                placeholder="prod-web-01"
                required
              />
              <span className="field__help">Used in incidents, Telegram alerts, and scripts.</span>
            </div>
          </div>
    </fieldset>
  );
  /** Tabs mode: tabpanels; wizard mode: plain wrappers (each step's fieldset is already a named group). Inactive panels stay laid out (hidden + inert). */
  const panelProps = (key: SettingsSection) => ({
    id: `agent-settings-panel-${key}`,
    ...(wizard ? {} : { role: "tabpanel", "aria-labelledby": `agent-settings-tab-${key}` }),
    "data-active": isActive(key),
    inert: !isActive(key)
  });

  return (
    <>
      {message ? <div id="agent-form-error" className="form-banner form-banner--error" role="alert">{message}</div> : null}
      <form
        ref={formRef}
        className={`form-grid agent-settings-form${wizard ? " agent-settings-form--wizard" : ""}`}
        onSubmit={submit}
        noValidate
        aria-busy={submitting}
        aria-describedby={message ? "agent-form-error" : undefined}
      >
        {wizard ? <WizardSteps steps={wizard.steps} current={wizardStep} label="Agent Registration Progress" /> : serverDetails}

        <div className="agent-settings-tabs field--wide">
          {wizard ? null : <div className="history-tabs__list" role="tablist" aria-label="Agent Settings Sections">
            {sections.map(({ key, label, short, icon: Icon }) => <button key={key} id={`agent-settings-tab-${key}`} className="history-tabs__tab" type="button" role="tab" aria-label={label}
              aria-selected={section === key} aria-controls={`agent-settings-panel-${key}`} tabIndex={section === key ? 0 : -1}
              onClick={() => setSection(key)} onKeyDown={(event) => moveSection(event, key)}>
              <Icon aria-hidden="true" /><span className="agent-settings-tab__label">{label}</span><span className="agent-settings-tab__short">{short}</span>
              {key === "checks" && selectedChecks ? <span className="numeric">
                {Object.values(selectedChecks).filter(Boolean).length}/3</span> : null}
            </button>)}
          </div>}
          {/* Inactive panels stay laid out (hidden + inert) so the modal height does not jump between sections. */}
          <div className="agent-settings-panels">
            {wizard ? <div {...panelProps("server")}>{serverDetails}</div> : null}
            {selectedChecks && checks ? <div {...panelProps("checks")}>
              <AgentScriptChecks value={selectedChecks} onChange={setSelectedChecks}
                cannotEnable={checks.middlewareUrlSaved ? [] : ["middleware_api"]}
                help={`Turning a check off takes effect on the next heartbeat. Turning one on needs a script that runs it${checks.middlewareUrlSaved ? "" : " (Middleware API needs a URL)"}; rotate the secret if the installed script does not.`} />
            </div> : null}
            <div {...panelProps("resources")}>
          <fieldset className="form-section">
            <legend>Resource Thresholds</legend>
            <div className="form-section__grid form-section__grid--thresholds">
              <div className="field">
                <label htmlFor="agent-ram-utilization">RAM Usage Threshold (%)</label>
                <input id="agent-ram-utilization" inputMode="decimal" value={ramUtilization} onChange={(event) => setRamUtilization(event.target.value)} required />
                <span className="field__help">Alerts at or above this RAM usage.</span>
              </div>
              <div className="field">
                <label htmlFor="agent-storage-utilization">Storage Usage Threshold (%)</label>
                <input id="agent-storage-utilization" inputMode="decimal" value={storageUtilization} onChange={(event) => setStorageUtilization(event.target.value)} required />
                <span className="field__help">Alerts at or above this storage usage.</span>
              </div>
              <div className="field field--wide">
                <label htmlFor="agent-cpu-load">Load Per Core Threshold</label>
                <input id="agent-cpu-load" inputMode="decimal" value={cpuLoad} onChange={(event) => setCpuLoad(event.target.value)} required />
                <span className="field__help">Five-minute load divided by logical CPU count.</span>
              </div>
            </div>
          </fieldset>
            </div>
            <div {...panelProps("timing")}>
          <fieldset className="form-section">
            <legend>Alert Timing</legend>
            <div className="form-section__grid agent-settings-timing">
              <div className="field field--wide middleware-alert-policy">
                <label htmlFor="agent-middleware-failures">Consecutive Failures Before Alert</label>
                <select id="agent-middleware-failures" aria-describedby="agent-middleware-failures-help" value={middlewareFailureThreshold} onChange={event => setMiddlewareFailureThreshold(event.target.value)}>
                  {Array.from({length:10},(_,i)=>i+1).map(count=><option key={count} value={count}>{count}</option>)}
                </select>
                <span id="agent-middleware-failures-help" className="field__help">Middleware API failures required before alerting. A successful check resets the count.</span>
              </div>
                <div className="field">
                <label htmlFor="agent-heartbeat-interval">Alert If No Heartbeat For</label>
                  <select id="agent-heartbeat-interval" aria-describedby="agent-heartbeat-help" value={heartbeatInterval} onChange={(event) => setHeartbeatInterval(event.target.value)} required>
                    {[1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60].map((minutes) => (
                      <option value={minutes * 60} key={minutes}>{minutes} min</option>
                    ))}
                  </select>
                  <span id="agent-heartbeat-help" className="field__help">Queues an alert when no heartbeat arrives within this time. Other health checks are evaluated separately.</span>
                </div>
                <div className="field">
                <label htmlFor="agent-telegram-cooldown">Issue Alert Interval</label>
                  <select id="agent-telegram-cooldown" aria-describedby="agent-telegram-cooldown-help" value={telegramCooldown} onChange={(event) => setTelegramCooldown(event.target.value)} required>
                    {[5, 10, 15, 30, 60, 120, 360, 720, 1440].map((minutes) => (
                      <option value={minutes * 60} key={minutes}>{minutes < 60 ? `${minutes} min` : `${minutes / 60} hr${minutes === 60 ? "" : "s"}`}</option>
                    ))}
                  </select>
                  <span id="agent-telegram-cooldown-help" className="field__help">Minimum gap between successfully sent issue alerts.</span>
                </div>
                <div className="field">
                  <label htmlFor="agent-telegram-recovery">Recovery Interval</label>
                  <select id="agent-telegram-recovery" aria-describedby="agent-telegram-recovery-help" value={recoveryCooldown} onChange={event => setRecoveryCooldown(event.target.value)} required>
                    {[...new Set([10, 15, 30, 60, 120, 300, Number(recoveryCooldown)])].sort((left, right) => left - right).map(seconds => <option key={seconds} value={seconds}>{seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} sec`}</option>)}
                  </select>
                  <span id="agent-telegram-recovery-help" className="field__help">Short recovery delay; does not reset the issue interval.</span>
                </div>
              </div>
          </fieldset>
            </div>
          </div>
        </div>
        {wizard ? <div className="agent-settings-actions agent-wizard-actions field--wide">
          {wizardStep > 0 ? <button className="button button--secondary" type="button" disabled={submitting}
            onClick={() => { setValidationError(null); setWizardStep(wizardStep - 1); }}><ArrowLeft aria-hidden="true" />Back</button> : <span />}
          <button className="button button--primary" type="submit" disabled={submitting} aria-label={submitting ? submittingLabel : undefined}>
            {submitting ? <InlineLoader label={submittingLabel} />
              : <>{wizardStep < WIZARD_SECTIONS.length - 1 ? `Next: ${wizard.steps[wizardStep + 1].title}` : submitLabel}<ArrowRight aria-hidden="true" /></>}
          </button>
        </div> : <div className="agent-settings-actions field--wide">
          <button className="button button--primary" type="submit" disabled={submitting} aria-label={submitting ? submittingLabel : undefined}>
            {submitting ? <InlineLoader label={submittingLabel} /> : <><Save aria-hidden="true" />{submitLabel}</>}
          </button>
        </div>}
      </form>
    </>
  );
}
