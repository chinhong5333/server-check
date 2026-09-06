import type { AgentSummary } from "../../shared/contracts";
import { StatusBadge } from "./StatusBadge";

const statusFallback: Record<AgentSummary["status"], string | null> = {
  healthy: null,
  new: "Awaiting First Heartbeat",
  warning: "Warning condition detected",
  critical: "Critical condition detected",
  stale: "Monitoring data is stale"
};

export function agentStateCause(
  status: AgentSummary["status"],
  probableCause: string | null
): string | null {
  if (status === "healthy") return null;
  const normalizedCause = probableCause?.trim();
  if (normalizedCause && normalizedCause.toLowerCase() !== "no active condition") {
    return normalizedCause;
  }
  return statusFallback[status];
}

export function AgentStateDisplay({
  status,
  probableCause
}: {
  status: AgentSummary["status"];
  probableCause: string | null;
}) {
  const cause = agentStateCause(status, probableCause);
  return (
    <div className="agent-state-stack">
      <StatusBadge status={status} />
      {cause ? <small>{cause}</small> : null}
    </div>
  );
}
