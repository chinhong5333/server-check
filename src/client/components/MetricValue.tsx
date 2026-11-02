import { t } from "../i18n";
export function MetricValue({
  value,
  format,
  className = ""
}: {
  value: number | null | undefined;
  format: (value: number | null | undefined) => string;
  className?: string;
}) {
  const display = format(value);
  return (
    <span className={`numeric${className ? ` ${className}` : ""}`} aria-label={display === "--" ? t("No Data") : display}>
      {display}
    </span>
  );
}
