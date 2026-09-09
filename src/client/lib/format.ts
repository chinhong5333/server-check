const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1
});

const integerNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

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
  return `${normalized.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2
  })}%`;
}

export function formatLoadAverage(value: number | null | undefined): string {
  if (!valid(value)) return "--";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Displays decimal gigabytes (1 GB = 1,000,000,000 bytes), with equal precision for both capacities. */
export function formatCapacityPair(used: number, total: number): string {
  const format = (bytes: number) => (bytes / 1_000_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${format(used)} GB / ${format(total)} GB`;
}

export function formatRatio(value: number | null | undefined): string {
  if (!valid(value)) return "--";
  const normalized = Object.is(value, -0) ? 0 : value;
  if (normalized !== 0 && Math.abs(normalized) < 0.01) return `${normalized < 0 ? "-" : ""}<0.01x`;
  return `${normalized.toLocaleString("en-US", { maximumFractionDigits: 2 })}x`;
}

export function formatBytes(value: number | null | undefined): string {
  if (!valid(value)) return "--";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: amount >= 100 ? 0 : 1 })} ${units[index]}`;
}

export function formatLatency(value: number | null | undefined): string {
  if (!valid(value)) return "--";
  if (value < 1000) return `${integerNumber.format(value)} ms`;
  return `${(value / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} s`;
}

export function formatCount(value: number | null | undefined): string {
  if (!valid(value)) return "--";
  return Math.abs(value) >= 1000 ? compactNumber.format(value) : integerNumber.format(value);
}

export function formatIdentifierLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

export function formatDateTime(value: number | null | undefined): string {
  if (!valid(value)) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}

export function formatRelativeTime(value: number | null | undefined): string {
  if (!valid(value)) return "Never";
  const seconds = Math.round((value - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}
