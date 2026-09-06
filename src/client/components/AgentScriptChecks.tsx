import type { AgentChecks } from "../../shared/contracts";

export function AgentScriptChecks({ value, onChange, disabled = false }: {
  value: AgentChecks; onChange: (value: AgentChecks) => void; disabled?: boolean;
}) {
  return (
    <fieldset className="form-section field--wide" disabled={disabled}>
      <legend>Health Checks</legend>
      <div className="script-check-options">
        {([
          ["apache", "Apache", "XAMPP/LAMPP or systemd service."],
          ["nginx", "Nginx", "Systemd service or local process."],
          ["middleware_api", "Middleware API", "HTTP 200 from your health endpoint."]
        ] as const).map(([key, label, description]) => (
          <label className="script-check-option" key={key}>
            <input type="checkbox" checked={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} />
            <span><strong>{label}</strong><small>{description}</small></span>
          </label>
        ))}
      </div>
      <p className="field__help">Unchecked services are not monitored. These choices are applied by the generated script.</p>
    </fieldset>
  );
}
