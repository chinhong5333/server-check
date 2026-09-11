import { AlertTriangle, BellRing, CircleX, Clock3, RadioTower } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AgentHealthSnapshot, AgentSummary } from "../../shared/contracts";
import { formatDateTime, formatLatency } from "../lib/format";
import { agentStateCause } from "./AgentStateDisplay";
import { StatusBadge } from "./StatusBadge";

type SummaryAgent = Pick<AgentSummary, "status" | "probable_cause" | "last_heartbeat_at" | "heartbeat_interval_seconds" | "agent_version"> & {
  service_health?: AgentHealthSnapshot | null;
  middleware_failure_count?: number;
  middleware_failure_threshold?: number;
};

interface StatusNotice {
  tone: "warning" | "critical";
  title: string;
  message: string;
  diagnostic: string | null;
  delivery: "No Alert Queued" | "Alert Queued";
}

export function heartbeatDuration(milliseconds: number, roundUp = false): string {
  const seconds = Math.max(0, Math[roundUp ? "ceil" : "floor"](milliseconds / 1000));
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "Second" : "Seconds"}`;
  const minutes = Math[roundUp ? "ceil" : "floor"](milliseconds / 60000);
  const units = [
    [Math.floor(minutes / 1440), "Day"],
    [Math.floor((minutes % 1440) / 60), "Hour"],
    [minutes % 60, "Minute"]
  ] as const;
  return units.filter(([value]) => value > 0).slice(0, 2)
    .map(([value, label]) => `${value} ${label}${value === 1 ? "" : "s"}`).join(" ");
}

export function heartbeatSummary(agent: SummaryAgent, now: number) {
  const received = agent.last_heartbeat_at;
  const deadline = received === null ? null : received + agent.heartbeat_interval_seconds * 1000;
  const overdue = deadline !== null && now >= deadline;
  const status = overdue ? "critical" : received === null && agent.status === "healthy" ? "new" : agent.status;
  const qualifier = overdue ? "Heartbeat Overdue" : received === null
    ? "No Heartbeat Received" : status === "healthy" ? "Receiving Heartbeats"
    : status === "stale" ? "Telemetry Is Stale" : "Requires Attention";
  const cause = status === "new" ? null : agentStateCause(overdue ? agent.status : status, agent.probable_cause);
  return { received, deadline, overdue, status, qualifier,
    cause: overdue && cause?.toLowerCase() === "heartbeat overdue" ? null : cause,
    elapsed: received === null ? "Never" : `${heartbeatDuration(Math.max(0, now - received))} Ago`,
    timing: deadline === null ? null : heartbeatCountdown(Math.abs(deadline - now), !overdue) };
}

function heartbeatCountdown(milliseconds: number, roundUp: boolean): string {
  const seconds = Math.max(0, Math[roundUp ? "ceil" : "floor"](milliseconds / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))} Hr ${pad(Math.floor(seconds / 60) % 60)} Min ${pad(seconds % 60)} Sec`;
}

function middlewareDiagnostic(agent: SummaryAgent): string | null {
  const probe = agent.service_health?.middleware_api;
  if (!probe || probe.outcome !== "unhealthy") return null;
  const errorCode = probe.error_code?.split("_").map(word => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
  const error = probe.error_message?.trim() || errorCode || "Request Failed";
  const response = probe.http_status_code === null ? "No HTTP Response" : `HTTP ${probe.http_status_code}`;
  const latency = probe.latency_ms === null ? null : formatLatency(probe.latency_ms);
  return [error, response, latency].filter(Boolean).join(" · ");
}

function statusNotice(agent: SummaryAgent, summary: ReturnType<typeof heartbeatSummary>): StatusNotice | null {
  if (summary.overdue) {
    return {
      tone: "critical",
      title: "No Heartbeat Received",
      message: `No heartbeat was received within the configured ${heartbeatDuration(agent.heartbeat_interval_seconds * 1000).toLowerCase()} limit.`,
      diagnostic: summary.received === null ? null : `Last Heartbeat · ${summary.elapsed}`,
      delivery: "Alert Queued"
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
      title: reached ? "Middleware API Unhealthy" : "Middleware API Check Failed",
      message: reached
        ? `${progress} of ${threshold} consecutive failures reached the alert threshold.`
        : `${progress} of ${threshold} consecutive failures recorded. The next successful check will reset this count.`,
      diagnostic: middlewareDiagnostic(agent),
      delivery: reached ? "Alert Queued" : "No Alert Queued"
    };
  }

  if (!summary.cause || summary.status === "healthy" || summary.status === "new") return null;
  return {
    tone: summary.status === "warning" || summary.status === "stale" ? "warning" : "critical",
    title: summary.status === "stale" ? "Telemetry Is Stale" : "Agent Requires Attention",
    message: summary.cause,
    diagnostic: null,
    delivery: "Alert Queued"
  };
}

export function AgentHeartbeatSummary({ agent, help }: { agent: SummaryAgent; help: ReactNode }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const summary = heartbeatSummary(agent, now);
  const notice = statusNotice(agent, summary);
  const statusAnnouncement = [summary.status, summary.qualifier, notice?.title, notice?.message, notice?.delivery]
    .filter(Boolean).join(". ");
  return (
    <section className="agent-heartbeat-summary" aria-label="Agent Status Summary">
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{statusAnnouncement}</span>
      <header className="agent-heartbeat-summary__header">
        <div className="agent-heartbeat-summary__identity">
          <h2>Agent Status</h2>
          <div className="agent-heartbeat-summary__state">
            <StatusBadge status={summary.status} />
            <span className={summary.overdue ? "agent-heartbeat-summary__overdue" : ""}>{summary.qualifier}</span>
          </div>
        </div>
        <div className="agent-heartbeat-summary__tools">
          <span className="agent-heartbeat-summary__version">Agent Version <strong>{agent.agent_version ?? "Pending"}</strong></span>
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
          <span className="agent-heartbeat-summary__delivery">{notice.delivery}</span>
        </div>
      ) : null}
      <div className="agent-heartbeat-summary__metrics">
        <article className="agent-heartbeat-summary__metric">
          <span className="agent-heartbeat-summary__metric-icon" aria-hidden="true"><RadioTower /></span>
          <div>
            <span className="agent-heartbeat-summary__metric-label">Last Heartbeat Received</span>
            <strong className="agent-heartbeat-summary__metric-value">{summary.elapsed}</strong>
            <p>Last Received: {summary.received === null ? "Never" : (
              <time dateTime={new Date(summary.received).toISOString()}>{formatDateTime(summary.received)}</time>
            )}</p>
          </div>
        </article>
        <article className="agent-heartbeat-summary__metric">
          <span className="agent-heartbeat-summary__metric-icon" aria-hidden="true"><BellRing /></span>
          <div>
            <span className="agent-heartbeat-summary__metric-label">Alert If No Heartbeat For</span>
            <strong className="agent-heartbeat-summary__metric-value">{heartbeatDuration(agent.heartbeat_interval_seconds * 1000)}</strong>
            <p>The agent is marked overdue after this period.</p>
          </div>
        </article>
        <article className={`agent-heartbeat-summary__metric agent-heartbeat-summary__metric--deadline${summary.overdue ? " agent-heartbeat-summary__metric--overdue" : ""}`}
          title={summary.deadline === null ? undefined : `Marked Overdue At: ${formatDateTime(summary.deadline)}`}>
          <span className="agent-heartbeat-summary__metric-icon" aria-hidden="true"><Clock3 /></span>
          <div>
            <span className="agent-heartbeat-summary__metric-label">{summary.deadline === null ? "Waiting For First Heartbeat" : summary.overdue ? "Overdued" : "Time Until Marked Overdue"}</span>
            {summary.timing !== null ? <strong className="agent-heartbeat-summary__metric-value agent-heartbeat-summary__metric-value--timer" role="timer" aria-live="off">{summary.timing}</strong> : (
              <strong className="agent-heartbeat-summary__metric-value">Awaiting Data</strong>
            )}
            <p>{summary.deadline === null ? "A deadline starts after the first heartbeat." : <>Deadline: <time dateTime={new Date(summary.deadline).toISOString()}>{formatDateTime(summary.deadline)}</time></>}</p>
          </div>
        </article>
      </div>
    </section>
  );
}
