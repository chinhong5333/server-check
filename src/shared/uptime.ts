export const SERVER_RESTART_INCIDENT_TYPE = "server_restart";

type UptimeUnit = "Day" | "Hour" | "Minute" | "Second";
const englishUnit = (value: number, unit: UptimeUnit) => `${value} ${unit}${value === 1 ? "" : "s"}`;

/** Formats reported OS uptime without extrapolating through missing heartbeats. Wording defaults to English for server messages. */
export function formatServerUptime(seconds: number | null | undefined, unitLabel = englishUnit, unavailable = "Not Available"): string {
  if (seconds == null || !Number.isSafeInteger(seconds) || seconds < 0) return unavailable;
  const units = [[Math.floor(seconds / 86400), "Day"], [Math.floor(seconds / 3600) % 24, "Hour"],
    [Math.floor(seconds / 60) % 60, "Minute"], [seconds % 60, "Second"]] as const;
  const parts = units.filter(([value]) => value > 0).slice(0, 3)
    .map(([value, unit]) => unitLabel(value, unit));
  return parts.length ? parts.join(" ") : unitLabel(0, "Second");
}
