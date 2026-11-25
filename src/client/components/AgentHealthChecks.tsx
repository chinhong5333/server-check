import { CircleAlert, CircleCheck, CircleDashed, CircleHelp, CircleSlash, CircleX, Clock3, Link2, Server } from "lucide-react";
import type { AgentChecks, AgentHealthSnapshot, DatabaseHealthSnapshot, LastAliveDatabaseHealth } from "../../shared/contracts";
import { formatDateTime, formatLatency } from "../lib/format";
import { statusClock } from "../lib/status-clock";
import { AgentDatabaseHealth, databaseStatus } from "./AgentDatabaseHealth";
import { heartbeatDuration } from "./AgentHeartbeatSummary";
import { t } from "../i18n";

export function checkPresentation(enabled: boolean, status: string | undefined, stale: boolean) {
  if (!enabled) return { label: t("Not Monitored"), tone: "new", Icon: CircleDashed };
  if (!status) return { label: t("Awaiting Data"), tone: "new", Icon: CircleDashed };
  // Turned on after the script was generated: the installed script reports it as not run.
  if (status === "disabled") return { label: t("Needs New Script"), tone: "warning", Icon: CircleAlert };
  // Agent 1.5.0+ found no unit, process, or binary for this service on the server.
  if (status === "not_installed") return { label: t("Not Installed"), tone: "warning", Icon: CircleSlash };
  if (stale) return { label: t("Stale"), tone: "stale", Icon: Clock3 };
  if (status === "active" || status === "healthy") return { label: t("Healthy"), tone: "healthy", Icon: CircleCheck };
  if (status === "inactive" || status === "unhealthy") return { label: t("Error"), tone: "critical", Icon: CircleX };
  return { label: t("Unknown"), tone: "warning", Icon: CircleHelp };
}

export function AgentHealthChecks({ checks, snapshot, databaseHealth = null, lastAliveDatabaseHealth = null, lastMetricsAt, lastHeartbeatAt, intervalSeconds, telemetryStale, fetchedAt }: {
  checks: AgentChecks; snapshot: AgentHealthSnapshot | null; lastMetricsAt: number | null;
  databaseHealth?: DatabaseHealthSnapshot | null; lastAliveDatabaseHealth?: LastAliveDatabaseHealth | null; lastHeartbeatAt: number | null;
  intervalSeconds: number; telemetryStale: boolean; fetchedAt?: number | null;
}) {
  const asOf = statusClock(fetchedAt);
  const expired = telemetryStale || lastMetricsAt === null || lastHeartbeatAt === null
    || asOf >= lastMetricsAt + intervalSeconds * 1000
    || asOf >= lastHeartbeatAt + intervalSeconds * 1000;
  const cards = (["apache", "nginx", "middleware_api"] as const).map((key) => {
    const result = snapshot?.[key];
    const status = result && ("status" in result ? result.status : result.outcome);
    const failed = checks[key] && (status === "inactive" || status === "unhealthy");
    // A failure in the last report stays red after the report goes stale; it is not downgraded to a grey "Stale".
    const view = failed && expired ? { label: t("Last Report Failed"), tone: "critical", Icon: CircleX } : checkPresentation(checks[key], status, expired);
    const title = key === "apache" ? t("Apache Web Server") : key === "nginx" ? t("Nginx Web Server") : t("Middleware API");
    return { key, result, status, failed, view, title };
  }).sort((a, b) => Number(b.failed) - Number(a.failed));
  const middleware = snapshot?.middleware_api ?? null;
  const middlewareFailing = cards.some(card => card.key === "middleware_api" && card.failed);
  const database = databaseStatus({ snapshot: databaseHealth, stale: expired, monitored: checks.middleware_api, sourceFailing: middlewareFailing });
  const databaseFailing = checks.middleware_api && databaseHealth !== null && database.tone === "critical";
  const tones = [...cards.map(card => card.view.tone), database.tone];
  const tally = (tone: string) => tones.filter(item => item === tone).length;
  const attention = tally("critical");
  const notMonitored = cards.filter(card => !checks[card.key]).length + (checks.middleware_api ? 0 : 1);
  const failedServer = cards.find(card => card.failed && card.key !== "middleware_api");
  // One sentence for the most important failure: the middleware first, because the database reading depends on it.
  const problem = middlewareFailing ? {
    title: t("Middleware API Is Failing"),
    message: [middleware?.http_status_code == null ? t("It did not answer the health request.") : t("It answered with HTTP {0}.", middleware.http_status_code),
      databaseHealth === null ? t("Database health is read through this API, so the database cannot be checked until it recovers.") : null].filter(Boolean).join(" ")
  } : databaseFailing ? {
    title: t("Database Is Unavailable"),
    message: middleware?.outcome === "healthy" ? t("The Middleware API is healthy, but its database check failed.") : t("The database check failed.")
  } : failedServer ? {
    title: t("{0} Is Not Running", failedServer.title),
    message: t("The agent reported this service as inactive.")
  } : null;
  const reportedAt = lastMetricsAt === null ? null : `${formatDateTime(lastMetricsAt)} · ${t("{0} Ago", heartbeatDuration(Math.max(0, asOf - lastMetricsAt)))}`;
  return (
    <section className="agent-health-checks" aria-labelledby="agent-health-checks-title">
      <div className="section-heading"><div><h2 id="agent-health-checks-title">{t("Health Checks")}</h2>
        <p>{t("Web servers report local service status. Middleware reports HTTP responsiveness.")}</p></div>
        <div className="agent-health-checks__counts">
          {attention ? <span className="agent-health-checks__count agent-health-checks__count--critical">{attention === 1 ? t("1 Needs Attention") : t("{0} Need Attention", attention)}</span> : null}
          {tally("warning") ? <span className="agent-health-checks__count">{t("{0} To Review", tally("warning"))}</span> : null}
          {tally("healthy") ? <span className="agent-health-checks__count agent-health-checks__count--healthy">{t("{0} Healthy", tally("healthy"))}</span> : null}
          {tally("stale") ? <span className="agent-health-checks__count">{t("{0} Stale", tally("stale"))}</span> : null}
          {notMonitored ? <span className="agent-health-checks__count">{t("{0} Not Monitored", notMonitored)}</span> : null}
        </div></div>
      {problem ? <div className="agent-health-checks__alert" role="alert">
        <span className="agent-health-checks__alert-icon" aria-hidden="true"><CircleX /></span>
        <div><strong>{problem.title}</strong>
          <p>{problem.message}{reportedAt ? ` ${t("Last report: {0}.", reportedAt)}` : ""}</p></div>
      </div> : null}
      <div className="agent-health-checks__grid">
        {cards.map(({ key, result, status, failed, view, title }) => {
          const CheckIcon = key === "middleware_api" ? Link2 : Server;
          const api = key === "middleware_api" ? snapshot?.middleware_api : null;
          return <div className={`agent-health-check${failed ? " agent-health-check--failing" : ""}${checks[key] ? "" : " agent-health-check--off"}`} key={key} aria-label={title}>
            <div className="agent-health-check__title">
              <span className={`status-tile status-tile--sm status-tile--${view.tone}`} aria-hidden="true"><CheckIcon /></span>
              <h3>{title}</h3>
            </div>
            <span className={`status status--${view.tone}`}><view.Icon aria-hidden="true" />{view.label}</span>
            {checks[key] && result && status !== "disabled" ? <dl className="agent-health-check__rows">
              {api ? <div><dt>{t("Response")}</dt>
                <dd className={failed ? "agent-health-check__bad" : undefined}>{`${api.http_status_code === null ? t("No HTTP Response") : `HTTP ${api.http_status_code}`} · ${formatLatency(api.latency_ms)}`}</dd></div> : null}
              {api?.error_message || api?.error_code ? <div><dt>{t("Error Detail")}</dt><dd className="agent-health-check__detail">{api.error_message || api.error_code}</dd></div> : null}
              {lastMetricsAt ? <div><dt>{key === "middleware_api" ? t("Last Checked") : t("Last Report")}</dt>
                <dd><time dateTime={new Date(lastMetricsAt).toISOString()}>{reportedAt}</time></dd></div> : null}
            </dl> : <p className="field__help">{!checks[key] ? t("Turned off for this agent.")
              : status === "disabled" ? t("The installed script does not run this check. Rotate the secret to install one that does.")
              : t("Waiting for a report from the installed script.")}</p>}
          </div>;
        })}
      </div>
      <AgentDatabaseHealth snapshot={databaseHealth} lastAlive={lastAliveDatabaseHealth} stale={expired} monitored={checks.middleware_api}
        sourceFailing={middlewareFailing} asOf={asOf} />
    </section>
  );
}
