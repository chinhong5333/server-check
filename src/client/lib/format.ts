import { formatServerUptime } from "../../shared/uptime";
import { intlLocale, perLocale, t } from "../i18n";
const DURATION_LABELS = {
  Day: ["{0} Day", "{0} Days"],
  Hour: ["{0} Hour", "{0} Hours"],
  Minute: ["{0} Minute", "{0} Minutes"],
  Second: ["{0} Second", "{0} Seconds"]
} as const;

export function durationLabel(value: number, unit: keyof typeof DURATION_LABELS): string {
  return t(DURATION_LABELS[unit][value === 1 ? 0 : 1], value);
}

/** Reported OS uptime in the page language. */
export function serverUptimeText(seconds: number | null | undefined): string {
  return formatServerUptime(seconds, durationLabel, t("Not Available"));
}

const compactNumber = perLocale(() => new Intl.NumberFormat(intlLocale, {
  notation: "compact",
  maximumFractionDigits: 1
}));

const integerNumber = perLocale(() => new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 0 }));

function valid(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

export function utilizationFromAvailable(value: number | null | undefined): number | null {
  if (!valid(value)) return null;
  return Number((100 - value).toFixed(2));
}

export function availableFromUtilization(value: number): number {
  return Number((100 - value).toFixed(2));
}

export function formatPercent(value: number | null | undefined): string {
  if (!valid(value)) return "--";
  const normalized = Object.is(value, -0) ? 0 : value;
  if (normalized !== 0 && Math.abs(normalized) < 0.01) return `${normalized < 0 ? "-" : ""}<0.01%`;
  return `${normalized.toLocaleString(intlLocale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2
  })}%`;
}

export function formatLoadAverage(value: number | null | undefined): string {
  if (!valid(value)) return "--";
  return value.toLocaleString(intlLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Displays decimal gigabytes (1 GB = 1,000,000,000 bytes), with equal precision for both capacities. */
export function formatCapacityPair(used: number, total: number): string {
  const format = (bytes: number) => (bytes / 1024 ** 3).toLocaleString(intlLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${format(used)} GiB / ${format(total)} GiB`;
}

export function formatRatio(value: number | null | undefined): string {
  if (!valid(value)) return "--";
  const normalized = Object.is(value, -0) ? 0 : value;
  if (normalized !== 0 && Math.abs(normalized) < 0.01) return `${normalized < 0 ? "-" : ""}<0.01x`;
  return `${normalized.toLocaleString(intlLocale, { maximumFractionDigits: 2 })}x`;
}

export function formatBytes(value: number | null | undefined): string {
  if (!valid(value)) return "--";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  return `${amount.toLocaleString(intlLocale, { maximumFractionDigits: amount >= 100 ? 0 : 1 })} ${units[index]}`;
}

export function formatLatency(value: number | null | undefined): string {
  if (!valid(value)) return "--";
  if (value < 1000) return `${integerNumber().format(value)} ms`;
  return `${(value / 1000).toLocaleString(intlLocale, { maximumFractionDigits: 2 })} s`;
}

export function formatCount(value: number | null | undefined): string {
  if (!valid(value)) return "--";
  return Math.abs(value) >= 1000 ? compactNumber().format(value) : integerNumber().format(value);
}

export function formatIdentifierLabel(value: string): string {
  return t(value
    .replaceAll("_", " ")
    .replace(/\b[a-z]/g, (character) => character.toUpperCase()));
}

export function formatDateTime(value: number | null | undefined): string {
  if (!valid(value)) return t("Never");
  return new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}

export function formatRelativeTime(value: number | null | undefined, now = Date.now()): string {
  if (!valid(value)) return t("Never");
  const seconds = Math.round((value - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}
