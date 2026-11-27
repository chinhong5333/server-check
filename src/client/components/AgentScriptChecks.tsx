import { useId } from "react";
import type { AgentChecks } from "../../shared/contracts";
import { t } from "../i18n";

export function AgentScriptChecks({ value, onChange, disabled = false, help, cannotEnable = [], cannotEnableReason }: {
  value: AgentChecks; onChange: (value: AgentChecks) => void; disabled?: boolean;
  /** Replaces the default script-generation help text. */
  help?: string;
  /** Checks that may be turned off but not on (for example, Middleware API without a saved URL). */
  cannotEnable?: (keyof AgentChecks)[];
  /** Shown inside each locked option, so the reason sits next to the control it explains. */
  cannotEnableReason?: string;
}) {
  const reasonId = useId();
  return (
    <fieldset className="form-section field--wide" disabled={disabled}>
      <legend>{t("Health Checks")}</legend>
      <div className="script-check-options">
        {([
          ["apache", t("Apache"), t("XAMPP/LAMPP or systemd service.")],
          ["nginx", t("Nginx"), t("Systemd service or local process.")],
          ["middleware_api", t("Middleware API"), t("HTTP 200 from your health endpoint.")]
        ] as const).map(([key, label, description]) => {
          const locked = !value[key] && cannotEnable.includes(key);
          return (
            <label className="script-check-option" key={key}>
              <input type="checkbox" checked={value[key]} disabled={locked}
                aria-describedby={locked && cannotEnableReason ? `${reasonId}-${key}` : undefined}
                onChange={(event) => onChange({ ...value, [key]: event.target.checked })} />
              <span>
                <strong>{label}</strong><small>{description}</small>
                {locked && cannotEnableReason ? <small id={`${reasonId}-${key}`} className="script-check-option__reason">{cannotEnableReason}</small> : null}
              </span>
            </label>
          );
        })}
      </div>
      <p className="field__help">{help ?? t("Unchecked services are not monitored. You can change this later in Manage without a new script.")}</p>
    </fieldset>
  );
}
