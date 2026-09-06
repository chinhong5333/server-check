import { AlertTriangle, CircleCheck, CircleDashed, CircleX, Radio } from "lucide-react";

const statusConfig = {
  healthy: { label: "Healthy", icon: CircleCheck },
  warning: { label: "Warning", icon: AlertTriangle },
  critical: { label: "Critical", icon: CircleX },
  stale: { label: "Stale", icon: Radio },
  new: { label: "Awaiting Data", icon: CircleDashed },
  open: { label: "Open", icon: CircleX },
  resolved: { label: "Resolved", icon: CircleCheck }
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
