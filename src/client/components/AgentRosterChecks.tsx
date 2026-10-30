import type { AgentSummary } from "../../shared/contracts";
import { DEFAULT_AGENT_CHECKS } from "../../shared/contracts";
import { checkPresentation } from "./AgentHealthChecks";

/** Aligned check/status table; absence and stale reports never imply health. */
export function AgentRosterChecks({ agent }: { agent: AgentSummary }) {
  const checks = agent.checks ?? DEFAULT_AGENT_CHECKS;
  const stale = agent.status === "stale" || agent.last_metrics_at === null || agent.last_heartbeat_at === null
    || Date.now() >= agent.last_metrics_at + agent.heartbeat_interval_seconds * 1000
    || Date.now() >= agent.last_heartbeat_at + agent.heartbeat_interval_seconds * 1000;
  const items = [
    { name: "Apache", enabled: checks.apache, status: agent.service_health?.apache.status },
    { name: "Nginx", enabled: checks.nginx, status: agent.service_health?.nginx.status },
    { name: "Middleware API", enabled: checks.middleware_api, status: agent.health_outcome ?? undefined },
    { name: "Database", enabled: checks.middleware_api,
      status: agent.database_status == null ? undefined : agent.database_status.toLowerCase() === "alive" ? "healthy" : "unhealthy" }
  ];
  return <table className="agent-roster-checks" aria-label={`Health Checks For ${agent.server_name}`}>
    <tbody>
    {items.map((item) => {
      const view = checkPresentation(item.enabled, item.status, stale);
      const label = item.name === "Database" && item.enabled && !item.status ? "Not Reported" : view.label;
      return <tr key={item.name} className={`agent-roster-check agent-roster-check--${view.tone}`}>
        <th scope="row" aria-label={item.name} title={item.name}>{item.name === "Middleware API" ? "API" : item.name}</th><td><span><view.Icon aria-hidden="true" />{label}</span></td>
      </tr>;
    })}
    </tbody>
  </table>;
}
