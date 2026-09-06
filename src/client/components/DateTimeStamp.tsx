const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "short",
  year: "numeric"
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit"
});

function compactDate(value: number): string {
  const parts = dateFormatter.formatToParts(value);
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
        <span>{timeFormatter.format(value)}</span>
      </time>
    </span>
  );
}
