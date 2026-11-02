import { intlLocale, locale, perLocale } from "../i18n";

const dateFormatter = perLocale(() => new Intl.DateTimeFormat(intlLocale, {
  day: "2-digit",
  month: "short",
  year: "numeric"
}));

const timeFormatter = perLocale(() => new Intl.DateTimeFormat(intlLocale, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit"
}));

function compactDate(value: number): string {
  if (locale === "zh-CN") return dateFormatter().format(value);
  const parts = dateFormatter().formatToParts(value);
  const day = parts.find((part) => part.type === "day")?.value ?? "--";
  const month = parts.find((part) => part.type === "month")?.value ?? "---";
  const year = parts.find((part) => part.type === "year")?.value ?? "----";
  return `${day} ${month} ${year}`;
}

export function DateTimeStamp({ value, label }: { value: number; label?: string }) {
  return (
    <span className="date-time-stamp">
      {label ? <span className="date-time-stamp__label">{label}</span> : null}
      <time dateTime={new Date(value).toISOString()}>
        <span>{compactDate(value)}</span>
        <span>{timeFormatter().format(value)}</span>
      </time>
    </span>
  );
}
