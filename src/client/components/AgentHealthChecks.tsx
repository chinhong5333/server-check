import { CircleCheck, CircleDashed, CircleHelp, CircleX, Clock3 } from "lucide-react";
import type { AgentChecks, AgentHealthSnapshot } from "../../shared/contracts";
import { formatDateTime, formatLatency } from "../lib/format";

export function checkPresentation(enabled: boolean, status: string | undefined, stale: boolean) {
  if (!enabled) return { label: "Not Monitored", tone: "new", Icon: CircleDashed };
  if (!status) return { label: "Awaiting Data", tone: "new", Icon: CircleDashed };
  if (stale) return { label: "Stale", tone: "stale", Icon: Clock3 };
  if (status === "active" || status === "healthy") return { label: "Healthy", tone: "healthy", Icon: CircleCheck };
  if (status === "inactive" || status === "unhealthy") return { label: "Error", tone: "critical", Icon: CircleX };
  return { label: "Unknown", tone: "warning", Icon: CircleHelp };
}

export function AgentHealthChecks({ checks, snapshot, lastMetricsAt, lastHeartbeatAt, intervalSeconds, telemetryStale }: {
  checks: AgentChecks; snapshot: AgentHealthSnapshot | null; lastMetricsAt: number | null;
  lastHeartbeatAt: number | null; intervalSeconds: number; telemetryStale: boolean;
}) {
  const expired = telemetryStale || lastMetricsAt === null || lastHeartbeatAt === null
    || Date.now() >= lastMetricsAt + intervalSeconds * 1000
    || Date.now() >= lastHeartbeatAt + intervalSeconds * 1000;
  return (
    <section className="agent-health-checks" aria-labelledby="agent-health-checks-title">
      <div className="section-heading"><div><h2 id="agent-health-checks-title">Health Checks</h2>
        <p>Web servers report local service status. Middleware reports HTTP responsiveness.</p></div></div>
      <div className="agent-health-checks__grid">
        {(["apache", "nginx", "middleware_api"] as const).map((key) => {
          const result = snapshot?.[key];
          const status = result && ("status" in result ? result.status : result.outcome);
          const view = checkPresentation(checks[key], status, expired);
          const title = key === "apache" ? "Apache Web Server" : key === "nginx" ? "Nginx Web Server" : "Middleware API";
          const api = key === "middleware_api" ? snapshot?.middleware_api : null;
          return <div className="agent-health-check" key={key} aria-label={title}>
            <h3>{title}</h3>
            <span className={`status status--${view.tone}`}><view.Icon aria-hidden="true" />{view.label}</span>
            {checks[key] && result && status !== "disabled" ? <>
              {api ? <p className="field__help">{expired ? "Last Report: " : ""}
                {`${api.http_status_code === null ? "No HTTP Response" : `HTTP ${api.http_status_code}`} · ${formatLatency(api.latency_ms)}`}
              </p> : null}
              {api?.error_message || api?.error_code ? <p className="field__help">{api.error_message || api.error_code}</p> : null}
              {lastMetricsAt ? <div className="agent-health-check__updated">
                <span className="field__help">Last Updated</span>
                <time className="field__help" dateTime={new Date(lastMetricsAt).toISOString()}>{formatDateTime(lastMetricsAt)}</time>
              </div> : null}
            </> : <p className="field__help">{checks[key] ? "Waiting for a report from the installed script." : "Disabled in the latest generated script."}</p>}
          </div>;
        })}
      </div>
    </section>
  );
}
