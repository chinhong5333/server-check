import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  updateAgentBodySchema,
  type AgentEditableInput
} from "../../shared/contracts";
import { InlineLoader } from "./Feedback";
import { useToast } from "./ToastProvider";
import { availableFromUtilization, utilizationFromAvailable } from "../lib/format";

interface AgentFormProps {
  initialValues?: AgentEditableInput;
  submitting: boolean;
  submitLabel: string;
  submittingLabel: string;
  error: string | null;
  onSubmit: (values: AgentEditableInput) => void;
}

export function AgentForm({
  initialValues,
  submitting,
  submitLabel,
  submittingLabel,
  error,
  onSubmit
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
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const validation = updateAgentBodySchema.safeParse({
      server_name: serverName,
      ram_available_threshold_percent: availableFromUtilization(Number(ramUtilization)),
      disk_available_threshold_percent: availableFromUtilization(Number(storageUtilization)),
      load_5_per_core_threshold: Number(cpuLoad),
      heartbeat_interval_seconds: Number(heartbeatInterval),
      telegram_alert_cooldown_seconds: Number(telegramCooldown)
    });
    if (!validation.success) {
      const message = "Check the server details, utilization thresholds, heartbeat interval, and Telegram send interval.";
      setValidationError(message);
      showToast({ tone: "error", message });
      return;
    }
    setValidationError(null);
    onSubmit(validation.data);
  };

  const message = validationError ?? error;

  return (
    <>
      {message ? <div id="agent-form-error" className="form-banner form-banner--error" role="alert">{message}</div> : null}
      <form
        className="form-grid"
        onSubmit={submit}
        noValidate
        aria-busy={submitting}
        aria-describedby={message ? "agent-form-error" : undefined}
      >
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

        <div className="agent-form-policy-row field--wide">
          <fieldset className="form-section">
            <legend>Alert Thresholds</legend>
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
                <span className="field__help">Alerts when five-minute load divided by logical CPU count reaches this value.</span>
              </div>
            </div>
          </fieldset>

          <div className="agent-form-policy-side">
            <fieldset className="form-section">
              <legend>Heartbeat</legend>
              <div className="form-section__grid">
                <div className="field">
                <label htmlFor="agent-heartbeat-interval">Heartbeat Interval</label>
                  <select id="agent-heartbeat-interval" value={heartbeatInterval} onChange={(event) => setHeartbeatInterval(event.target.value)} required>
                    {[1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60].map((minutes) => (
                      <option value={minutes * 60} key={minutes}>{minutes} min</option>
                    ))}
                  </select>
                  <span className="field__help">Alerts when no report arrives within this interval.</span>
                </div>
              </div>
            </fieldset>

            <fieldset className="form-section">
              <legend>Telegram Alerts</legend>
              <div className="form-section__grid">
                <div className="field">
                <label htmlFor="agent-telegram-cooldown">Telegram Send Interval</label>
                  <select id="agent-telegram-cooldown" value={telegramCooldown} onChange={(event) => setTelegramCooldown(event.target.value)} required>
                    {[5, 10, 15, 30, 60, 120, 360, 720, 1440].map((minutes) => (
                      <option value={minutes * 60} key={minutes}>{minutes < 60 ? `${minutes} min` : `${minutes / 60} hr${minutes === 60 ? "" : "s"}`}</option>
                    ))}
                  </select>
                  <span className="field__help">Minimum wait after a successful Telegram message.</span>
                </div>
              </div>
            </fieldset>
          </div>
        </div>
        <button className="button button--primary field--wide" type="submit" disabled={submitting}>
          {submitting ? <InlineLoader label={submittingLabel} /> : submitLabel}
        </button>
      </form>
    </>
  );
}
