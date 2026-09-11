import { PERMISSIONS, type Permission } from "../../shared/permissions";

export function PermissionChecklist({ value, onChange, disabled = false }: {
  value: Permission[]; onChange: (permissions: Permission[]) => void; disabled?: boolean;
}) {
  const needsView = value.some(key => key !== "view_projects" && key !== "edit_global_settings");
  return <fieldset className="form-section field--wide permission-list" disabled={disabled}>
    <legend>Permissions</legend>
    {PERMISSIONS.map(permission => <label key={permission.key}>
      <input type="checkbox" checked={value.includes(permission.key)}
        disabled={disabled || permission.key === "view_projects" && needsView}
        onChange={event => {
          const next = event.target.checked ? [...value, permission.key] : value.filter(key => key !== permission.key);
          if (event.target.checked && permission.key !== "view_projects" && permission.key !== "edit_global_settings" && !next.includes("view_projects")) next.push("view_projects");
          onChange(next);
        }} />
      <span>{permission.label}</span>
    </label>)}
    <p className="field__help">Project and agent actions require view access. Delete and secret rotation are granted separately. Teams management is reserved for admins.</p>
  </fieldset>;
}
