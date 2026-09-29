/* Hallmark · component: maintenance indicator · genre: modern-minimal · theme: existing Cobalt
 * passive states: absent · scheduled · active · pre-emit critique: P5 H5 E5 S5 R5 V4
 */
import { CalendarClock, Wrench } from "lucide-react";
import type { MaintenanceIndicator } from "../../shared/contracts";

/** Compact, non-interactive status marker; health severity remains unchanged. */
export function MaintenanceIcon({ maintenance }: { maintenance?: MaintenanceIndicator | null }) {
  if (!maintenance) return null;
  const label = `${maintenance.scope === "project" ? "Project" : "Agent"} Maintenance ${maintenance.status === "active" ? "Active" : "Scheduled"}`;
  const Icon = maintenance.status === "active" ? Wrench : CalendarClock;
  return <span className={`maintenance-icon maintenance-icon--${maintenance.status}`} role="img" aria-label={label} title={label}><Icon aria-hidden="true" /></span>;
}
