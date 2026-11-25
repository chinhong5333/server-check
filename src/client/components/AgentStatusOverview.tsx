import { AlertTriangle, CircleX } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { formatDateTime, serverUptimeText } from "../lib/format";
import { statusClock } from "../lib/status-clock";
import { heartbeatDuration, heartbeatSummary, statusNotice, type SummaryAgent } from "./AgentHeartbeatSummary";
import { StatusBadge } from "./StatusBadge";
import { t } from "../i18n";

/** One latest-reading tile of the Ver 2 layout: a value with either a utilization meter or a short trend line. */
export function ReadingTile({ label, value, series, percent, detail, trend }: {
  label: string; value: string; series: "ram" | "storage" | "load" | "latency";
  percent?: number | null; detail?: string | null; trend?: Array<number | null | undefined>;
}) {
  const values = (trend ?? []).filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  return <article className="agent-reading" data-series={series} aria-label={label}>
    <span className="agent-reading__label">{label}</span>
    <strong className="agent-reading__value numeric">{value}</strong>
    {/* Decorative: the value above is the accessible reading. */}
    {percent != null ? <span className="agent-reading__meter" aria-hidden="true">
      <span style={{ transform: `scaleX(${Math.min(1, Math.max(0, percent / 100))})` }} />
    </span> : null}
    {values.length > 1 ? <svg className="agent-reading__spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={values.map((item, index) => `${(index / (values.length - 1)) * 100},${22 - ((item - low) / span) * 20}`).join(" ")} />
    </svg> : null}
    {detail ? <p className="numeric">{detail}</p> : null}
  </article>;
}

/** Ver 2 status block: state line, the current problem if any, then the latest readings in one row. */
export function AgentStatusOverview({ agent, help, readings, notificationsMuted = false, fetchedAt }: {
  agent: SummaryAgent; help: ReactNode; readings: ReactNode; notificationsMuted?: boolean; fetchedAt?: number | null;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const asOf = statusClock(fetchedAt, now);
  const summary = heartbeatSummary(agent, asOf);
  const notice = statusNotice(agent, summary);
  const remaining = summary.deadline === null || summary.overdue ? 0
    : Math.min(1, (summary.deadline - asOf) / (agent.heartbeat_interval_seconds * 1000));
  const delivery = notificationsMuted ? t("TG Muted During Maintenance") : notice?.delivery;
  return <section className="agent-overview" aria-label={t("Agent Status Summary")}>
    <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {[summary.status, summary.qualifier, notice?.title, notice?.message, delivery].filter(Boolean).join(". ")}
    </span>
    <div className="agent-overview__meta">
      <StatusBadge status={summary.status} />
      {/* A healthy badge already says heartbeats are arriving. */}
      {summary.status === "healthy" ? null : <span className={`agent-overview__qualifier${summary.overdue ? " agent-heartbeat-summary__overdue" : ""}`}>{summary.qualifier}</span>}
      <span>{t("Agent Version")}{" "}<strong className="numeric">{agent.agent_version ?? t("Not Reported")}</strong></span>
      <span>{t("Server Uptime")}{" "}<strong className="numeric">{serverUptimeText(agent.uptime_seconds)}</strong></span>
      <span>{t("Alert If No Heartbeat For")}{" "}<strong>{heartbeatDuration(agent.heartbeat_interval_seconds * 1000)}</strong></span>
      {help}
    </div>
    {notice ? <div className={`agent-overview__notice agent-overview__notice--${notice.tone}`}>
      <span className="agent-overview__notice-icon" aria-hidden="true">{notice.tone === "critical" ? <CircleX /> : <AlertTriangle />}</span>
      <div className="agent-overview__notice-copy">
        <span className="agent-overview__eyebrow">{t("Needs Attention")}</span>
        <strong>{notice.title}</strong>
        <p>{notice.message}</p>
        {notice.diagnostic ? <span className="agent-overview__diagnostic">{notice.diagnostic}</span> : null}
      </div>
      <span className="agent-overview__delivery">{delivery}</span>
    </div> : null}
    <div className="agent-overview__readings" role="group" aria-label={t("Latest Readings")}>
      <article className={`agent-reading${summary.overdue ? " agent-reading--overdue" : ""}`} data-series="heartbeat" aria-label={t("Last Heartbeat Received")}>
        <span className="agent-reading__label">{t("Last Heartbeat Received")}</span>
        <strong className="agent-reading__value">{summary.elapsed}</strong>
        {summary.deadline !== null ? <span className={`agent-heartbeat-summary__countdown${summary.overdue ? " agent-heartbeat-summary__countdown--overdue" : remaining <= 0.25 ? " agent-heartbeat-summary__countdown--low" : ""}`} aria-hidden="true">
          <span style={{ transform: `scaleX(${remaining})` }} />
        </span> : null}
        <p title={summary.deadline === null ? undefined : t("Marked Overdue At: {0}", formatDateTime(summary.deadline))}>
          {summary.deadline === null ? t("A deadline starts after the first heartbeat.")
            : <>{summary.overdue ? t("Overdued") : t("Time Until Marked Overdue")}{" "}<strong role="timer" aria-live="off">{summary.timing}</strong></>}
        </p>
      </article>
      {readings}
    </div>
  </section>;
}
