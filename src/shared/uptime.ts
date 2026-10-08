export const SERVER_RESTART_INCIDENT_TYPE = "server_restart";

/** Formats reported OS uptime without extrapolating through missing heartbeats. */
export function formatServerUptime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isSafeInteger(seconds) || seconds < 0) return "Not Available";
  const units = [[Math.floor(seconds / 86400), "Day"], [Math.floor(seconds / 3600) % 24, "Hour"],
    [Math.floor(seconds / 60) % 60, "Minute"], [seconds % 60, "Second"]] as const;
  const parts = units.filter(([value]) => value > 0).slice(0, 3)
    .map(([value, label]) => `${value} ${label}${value === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" ") : "0 Seconds";
}
