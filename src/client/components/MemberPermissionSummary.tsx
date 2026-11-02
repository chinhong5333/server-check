import { Check, Eye, X } from "lucide-react";
import { useRef, useState } from "react";
import { PERMISSIONS, type Permission } from "../../shared/permissions";
import { ModalDialog } from "./ModalDialog";
import { t } from "../i18n";

/** Keep roster rows compact; the full read-only permission list is available on demand. */
export function MemberPermissionSummary({ member }: {
  member: { id: string; email: string; permissions: Permission[] };
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const granted = PERMISSIONS.filter(permission => member.permissions.includes(permission.key));
  if (!granted.length) return <span>{t("No Permissions")}</span>;
  const titleId = `member-permissions-title-${member.id}`;
  return <>
    <button ref={trigger} type="button" className="button button--secondary member-permission-summary"
      aria-label={t("View Permissions For {0}", member.email)} aria-haspopup="dialog"
      onClick={() => setOpen(true)}><Eye aria-hidden="true" />{granted.length} {granted.length === 1 ? t("Permission") : t("Permissions")}</button>
    <ModalDialog id={`member-permissions-${member.id}`} open={open} labelledBy={titleId}
      restoreFocusTo={trigger.current} dialogClassName="team-dialog" surfaceClassName="agent-dialog__surface form-surface">
      <div className="section-heading"><div><h2 id={titleId}>{t("Assigned Permissions")}</h2><p>{member.email}</p></div>
        <button data-dialog-initial-focus className="icon-button" type="button" aria-label={t("Close Permissions View")} onClick={() => setOpen(false)}><X aria-hidden="true" /></button></div>
      <div className="member-permission-details">
        <span className="mono-label">{granted.length} {granted.length === 1 ? t("Permission") : t("Permissions")}</span>
        <ul>{granted.map(permission => <li key={permission.key}><Check aria-hidden="true" /><span>{t(permission.label)}</span></li>)}</ul>
      </div>
    </ModalDialog>
  </>;
}
