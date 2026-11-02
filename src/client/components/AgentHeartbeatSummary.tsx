import { AlertTriangle, BellRing, CircleX, Clock3, RadioTower, Timer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AgentHealthSnapshot, AgentSummary } from "../../shared/contracts";
import { durationLabel, formatDateTime, formatLatency, serverUptimeText } from "../lib/format";
import { agentStateCause } from "./AgentStateDisplay";
import { StatusBadge } from "./StatusBadge";
import { statusClock } from "../lib/status-clock";
import { t } from "../i18n";

type SummaryAgent = Pick<AgentSummary, "status" | "probable_cause" | "last_heartbeat_at" | "heartbeat_interval_seconds" | "agent_version"> & {
  service_health?: AgentHealthSnapshot | null;
  middleware_failure_count?: number;
  middleware_failure_threshold?: number;
  uptime_seconds?: number | null;
  uptime_received_at?: number | null;
};

interface StatusNotice {
  tone: "warning" | "critical";
  title: string;
  message: string;
  diagnostic: string | null;
  delivery: string;
}

export function heartbeatDuration(milliseconds: number, roundUp = false): string {
  const seconds = Math.max(0, Math[roundUp ? "ceil" : "floor"](milliseconds / 1000));
  if (seconds < 60) return durationLabel(seconds, "Second");
  const minutes = Math[roundUp ? "ceil" : "floor"](milliseconds / 60000);
  const units = [
    [Math.floor(minutes / 1440), "Day"],
    [Math.floor((minutes % 1440) / 60), "Hour"],
    [minutes % 60, "Minute"]
  ] as const;
  return units.filter(([value]) => value > 0).slice(0, 2)
    .map(([value, unit]) => durationLabel(value, unit)).join(" ");
}

export function heartbeatSummary(agent: SummaryAgent, now: number) {
  const received = agent.last_heartbeat_at;
  const deadline = received === null ? null : received + agent.heartbeat_interval_seconds * 1000;
  const overdue = deadline !== null && now >= deadline;
  const status = overdue ? "critical" : received === null && agent.status === "healthy" ? "new" : agent.status;
  const qualifier = overdue ? t("Heartbeat Overdue") : received === null
    ? t("No Heartbeat Received") : status === "healthy" ? t("Receiving Heartbeats")
    : status === "stale" ? t("Telemetry Is Stale") : t("Requires Attention");
  const cause = status === "new" ? null : agentStateCause(overdue ? agent.status : status, agent.probable_cause);
  return { received, deadline, overdue, status, qualifier,
    cause: overdue && cause?.toLowerCase() === "heartbeat overdue" ? null : cause,
    elapsed: received === null ? t("Never") : t("{0} Ago", heartbeatDuration(Math.max(0, now - received))),
    timing: deadline === null ? null : heartbeatCountdown(Math.abs(deadline - now), !overdue) };
}

function heartbeatCountdown(milliseconds: number, roundUp: boolean): string {
  const seconds = Math.max(0, Math[roundUp ? "ceil" : "floor"](milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  // Same Hour / Minute / Second wording as the other status values; leading zero units are omitted.
  return [hours > 0 ? durationLabel(hours, "Hour") : null, hours > 0 || minutes > 0 ? durationLabel(minutes, "Minute") : null, durationLabel(seconds % 60, "Second")]
    .filter(Boolean).join(" ");
}

function middlewareDiagnostic(agent: SummaryAgent): string | null {
  const probe = agent.service_health?.middleware_api;
  if (!probe || probe.outcome !== "unhealthy") return null;
  const errorCode = probe.error_code?.split("_").map(word => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
  const error = probe.error_message?.trim() || errorCode || t("Request Failed");
  const response = probe.http_status_code === null ? t("No HTTP Response") : `HTTP ${probe.http_status_code}`;
  const latency = probe.latency_ms === null ? null : formatLatency(probe.latency_ms);
  return [error, response, latency].filter(Boolean).join(" · ");
}

function statusNotice(agent: SummaryAgent, summary: ReturnType<typeof heartbeatSummary>): StatusNotice | null {
  if (summary.overdue) {
    return {
      tone: "critical",
      title: t("No Heartbeat Received"),
      message: t("No heartbeat was received within the configured {0} limit.", heartbeatDuration(agent.heartbeat_interval_seconds * 1000).toLowerCase()),
      diagnostic: summary.received === null ? null : t("Last Heartbeat · {0}", summary.elapsed),
      delivery: t("Alert Queued")
    };
  }

  const count = agent.middleware_failure_count;
  const threshold = agent.middleware_failure_threshold;
  const middlewareFailed = agent.service_health?.middleware_api.outcome === "unhealthy";
  const middlewareIsPrimary = summary.cause?.toLowerCase().includes("middleware api") ?? false;
  if (middlewareFailed && middlewareIsPrimary && Number.isInteger(count) && Number.isInteger(threshold) && count! > 0 && threshold! > 0) {
    const reached = count! >= threshold!;
    const progress = Math.min(count!, threshold!);
    return {
      tone: reached ? "critical" : "warning",
      title: reached ? t("Middleware API Unhealthy") : t("Middleware API Check Failed"),
      message: reached
        ? t("{0} of {1} consecutive failures reached the alert threshold.", progress, threshold!)
        : t("{0} of {1} consecutive failures recorded. The next successful check will reset this count.", progress, threshold!),
      diagnostic: middlewareDiagnostic(agent),
      delivery: reached ? t("Alert Queued") : t("No Alert Queued")
    };
  }

  if (!summary.cause || summary.status === "healthy" || summary.status === "new") return null;
  return {
    tone: summary.status === "warning" || summary.status === "stale" ? "warning" : "critical",
    title: summary.status === "stale" ? t("Telemetry Is Stale") : t("Agent Requires Attention"),
    message: t(summary.cause),
    diagnostic: null,
    delivery: t("Alert Queued")
  };
}

export function AgentHeartbeatSummary({ agent, help, notificationsMuted = false, fetchedAt }: { agent: SummaryAgent; help: ReactNode; notificationsMuted?: boolean; fetchedAt?: number | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const asOf = statusClock(fetchedAt, now);
  const summary = heartbeatSummary(agent, asOf);
  const uptimeReceived = agent.uptime_received_at ?? null;
  const uptimeStale = uptimeReceived !== null && asOf >= uptimeReceived + agent.heartbeat_interval_seconds * 1000;
  const notice = statusNotice(agent, summary);
  // Share of the heartbeat window left before the agent is marked overdue, for the countdown bar.
  const remaining = summary.deadline === null || summary.overdue ? 0
    : Math.min(1, (summary.deadline - asOf) / (agent.heartbeat_interval_seconds * 1000));
  const delivery = notificationsMuted ? t("TG Muted During Maintenance") : notice?.delivery;
  const statusAnnouncement = [summary.status, summary.qualifier, notice?.title, notice?.message, delivery]
    .filter(Boolean).join(". ");
  return (
    <section className="agent-heartbeat-summary agent-heartbeat-summary--uptime" aria-label={t("Agent Status Summary")}>
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{statusAnnouncement}</span>
      <header className="agent-heartbeat-summary__header">
        <div className="agent-heartbeat-summary__identity">
          <h2>{t("Agent Status")}</h2>
          <div className="agent-heartbeat-summary__state">
            <StatusBadge status={summary.status} />
            <span className={summary.overdue ? "agent-heartbeat-summary__overdue" : ""}>{summary.qualifier}</span>
          </div>
        </div>
        <div className="agent-heartbeat-summary__tools">
          <span className="agent-heartbeat-summary__version">{t("Agent Version")}{" "}<strong>{agent.agent_version ?? t("Not Reported")}</strong></span>
          {help}
        </div>
      </header>
      {notice ? (
        <div className={`agent-heartbeat-summary__notice agent-heartbeat-summary__notice--${notice.tone}`}>
          {notice.tone === "critical" ? <CircleX aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          <div className="agent-heartbeat-summary__notice-copy">
            <strong>{notice.title}</strong>
            <p>{notice.message}</p>
            {notice.diagnostic ? <span>{notice.diagnostic}</span> : null}
          </div>
          <span className="agent-heartbeat-summary__delivery">{delivery}</span>
        </div>
      ) : null}
      <div className="agent-heartbeat-summary__metrics">
        <article className="agent-heartbeat-summary__metric">
          <span className="agent-heartbeat-summary__metric-icon" aria-hidden="true"><RadioTower /></span>
          <div>
            <span className="agent-heartbeat-summary__metric-label">{t("Last Heartbeat Received")}</span>
            <strong className="agent-heartbeat-summary__metric-value">{summary.elapsed}</strong>
            <p>{t("Last Received:")}{" "}{summary.received === null ? t("Never") : (
              <time dateTime={new Date(summary.received).toISOString()}>{formatDateTime(summary.received)}</time>
            )}</p>
          </div>
        </article>
        <article className="agent-heartbeat-summary__metric">
          <span className="agent-heartbeat-summary__metric-icon" aria-hidden="true"><BellRing /></span>
          <div>
            <span className="agent-heartbeat-summary__metric-label">{t("Alert If No Heartbeat For")}</span>
            <strong className="agent-heartbeat-summary__metric-value">{heartbeatDuration(agent.heartbeat_interval_seconds * 1000)}</strong>
            <p>{t("The agent is marked overdue after this period.")}</p>
          </div>
        </article>
        <article className={`agent-heartbeat-summary__metric agent-heartbeat-summary__metric--deadline${summary.overdue ? " agent-heartbeat-summary__metric--overdue" : ""}`}
          title={summary.deadline === null ? undefined : t("Marked Overdue At: {0}", formatDateTime(summary.deadline))}>
          <span className="agent-heartbeat-summary__metric-icon" aria-hidden="true"><Clock3 /></span>
          <div>
            <span className="agent-heartbeat-summary__metric-label">{summary.deadline === null ? t("Waiting For First Heartbeat") : summary.overdue ? t("Overdued") : t("Time Until Marked Overdue")}</span>
            {summary.timing !== null ? <strong className="agent-heartbeat-summary__metric-value agent-heartbeat-summary__metric-value--timer" role="timer" aria-live="off">{summary.timing}</strong> : (
              <strong className="agent-heartbeat-summary__metric-value">{t("Awaiting Data")}</strong>
            )}
            {/* Decorative: the timer text above is the accessible value. */}
            {summary.deadline !== null ? <span className={`agent-heartbeat-summary__countdown${summary.overdue ? " agent-heartbeat-summary__countdown--overdue" : remaining <= 0.25 ? " agent-heartbeat-summary__countdown--low" : ""}`} aria-hidden="true">
              <span style={{ transform: `scaleX(${remaining})` }} />
            </span> : null}
            <p>{summary.deadline === null ? t("A deadline starts after the first heartbeat.") : <>{t("Deadline:")}{" "}<time dateTime={new Date(summary.deadline).toISOString()}>{formatDateTime(summary.deadline)}</time></>}</p>
          </div>
        </article>
        <article className="agent-heartbeat-summary__metric agent-heartbeat-summary__uptime" aria-label={t("Server Uptime")}>
          <span className="agent-heartbeat-summary__metric-icon" aria-hidden="true"><Timer /></span>
          <div>
            <span className="agent-heartbeat-summary__metric-label">{t("Server Uptime")}{uptimeStale ? <span className="agent-heartbeat-summary__uptime-stale">{t("Stale")}</span> : null}</span>
            <strong className="agent-heartbeat-summary__metric-value numeric">{serverUptimeText(agent.uptime_seconds)}</strong>
            <p>{uptimeReceived === null ? t("Awaiting a valid uptime report.") : <>{t("Last Reported:")}{" "}<time dateTime={new Date(uptimeReceived).toISOString()}>{formatDateTime(uptimeReceived)}</time></>}</p>
          </div>
        </article>
      </div>
    </section>
  );
}
