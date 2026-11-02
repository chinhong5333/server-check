/* Hallmark · component: maintenance indicator · genre: modern-minimal · theme: existing Cobalt
 * passive states: absent · scheduled · active · pre-emit critique: P5 H5 E5 S5 R5 V4
 */
import { CalendarClock, Wrench } from "lucide-react";
import type { MaintenanceIndicator } from "../../shared/contracts";
import { t } from "../i18n";

/** Compact, non-interactive status marker; health severity remains unchanged. */
export function MaintenanceIcon({ maintenance }: { maintenance?: MaintenanceIndicator | null }) {
  if (!maintenance) return null;
  const label = t("{0} Maintenance {1}", t(maintenance.scope === "project" ? "Project" : "Agent"), t(maintenance.status === "active" ? "Active" : "Scheduled"));
  const Icon = maintenance.status === "active" ? Wrench : CalendarClock;
  return <span className={`maintenance-icon maintenance-icon--${maintenance.status}`} role="img" aria-label={label} title={label}><Icon aria-hidden="true" /></span>;
}
