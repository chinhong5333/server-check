import { AlertTriangle, CircleCheck, CircleDashed, CircleX, Radio } from "lucide-react";
import { t } from "../i18n";

export const statusConfig = {
  healthy: { get label() { return t("Healthy"); }, icon: CircleCheck },
  warning: { get label() { return t("Warning"); }, icon: AlertTriangle },
  critical: { get label() { return t("Critical"); }, icon: CircleX },
  stale: { get label() { return t("Stale"); }, icon: Radio },
  new: { get label() { return t("Awaiting Data"); }, icon: CircleDashed },
  open: { get label() { return t("Open"); }, icon: CircleX },
  resolved: { get label() { return t("Resolved"); }, icon: CircleCheck }
} as const;

export function StatusBadge({ status }: { status: keyof typeof statusConfig }) {
  const config = statusConfig[status];
  const Icon = config.icon;
  return (
    <span className={`status status--${status}`}>
      <Icon aria-hidden="true" />
      {config.label}
    </span>
  );
}
