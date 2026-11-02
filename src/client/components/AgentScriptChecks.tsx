import type { AgentChecks } from "../../shared/contracts";
import { t } from "../i18n";

export function AgentScriptChecks({ value, onChange, disabled = false, help, cannotEnable = [] }: {
  value: AgentChecks; onChange: (value: AgentChecks) => void; disabled?: boolean;
  /** Replaces the default script-generation help text. */
  help?: string;
  /** Checks that may be turned off but not on (for example, Middleware API without a saved URL). */
  cannotEnable?: (keyof AgentChecks)[];
}) {
  return (
    <fieldset className="form-section field--wide" disabled={disabled}>
      <legend>{t("Health Checks")}</legend>
      <div className="script-check-options">
        {([
          ["apache", t("Apache"), t("XAMPP/LAMPP or systemd service.")],
          ["nginx", t("Nginx"), t("Systemd service or local process.")],
          ["middleware_api", t("Middleware API"), t("HTTP 200 from your health endpoint.")]
        ] as const).map(([key, label, description]) => (
          <label className="script-check-option" key={key}>
            <input type="checkbox" checked={value[key]} disabled={!value[key] && cannotEnable.includes(key)}
              onChange={(event) => onChange({ ...value, [key]: event.target.checked })} />
            <span><strong>{label}</strong><small>{description}</small></span>
          </label>
        ))}
      </div>
      <p className="field__help">{help ?? t("Unchecked services are not monitored. You can change this later in Manage without a new script.")}</p>
    </fieldset>
  );
}
