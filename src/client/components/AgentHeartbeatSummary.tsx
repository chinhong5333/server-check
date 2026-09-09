import { Clock3 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AgentSummary } from "../../shared/contracts";
import { formatDateTime } from "../lib/format";
import { agentStateCause } from "./AgentStateDisplay";
import { StatusBadge } from "./StatusBadge";

type SummaryAgent = Pick<AgentSummary, "status" | "probable_cause" | "last_heartbeat_at" | "heartbeat_interval_seconds" | "agent_version">;

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

export function AgentHeartbeatSummary({ agent, help }: { agent: SummaryAgent; help: ReactNode }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const summary = heartbeatSummary(agent, now);
  return (
    <section className="agent-heartbeat-summary" aria-label="Agent Status Summary">
      <header className="agent-heartbeat-summary__header">
        <div className="agent-heartbeat-summary__identity">
          <h2>Agent Status</h2>
          <div className="agent-heartbeat-summary__state" aria-live="polite">
            <StatusBadge status={summary.status} />
            <span className={summary.overdue ? "agent-heartbeat-summary__overdue" : ""}>{summary.qualifier}</span>
          </div>
        </div>
        <div className="agent-heartbeat-summary__tools">
          <span className="agent-heartbeat-summary__version">Agent Version <strong>{agent.agent_version ?? "Pending"}</strong></span>
          {help}
        </div>
      </header>
      {summary.cause ? <p className="agent-heartbeat-summary__cause">{summary.cause}</p> : null}
      <div className="agent-heartbeat-summary__body">
        <div>
          <dl className="agent-heartbeat-summary__facts">
            <div><dt>Last Heartbeat Received</dt><dd>{summary.elapsed}</dd></div>
            <div><dt>Alert If No Heartbeat For</dt><dd>{heartbeatDuration(agent.heartbeat_interval_seconds * 1000)}</dd></div>
          </dl>
          <p className="agent-heartbeat-summary__received">Last Received: {summary.received === null ? "Never" : (
            <time dateTime={new Date(summary.received).toISOString()}>{formatDateTime(summary.received)}</time>
          )}</p>
        </div>
        <div className={`agent-heartbeat-summary__deadline${summary.overdue ? " agent-heartbeat-summary__overdue" : ""}`}
          title={summary.deadline === null ? undefined : `Marked Overdue At: ${formatDateTime(summary.deadline)}`}>
          <Clock3 aria-hidden="true" />
          <div><span>{summary.deadline === null ? "Waiting For First Heartbeat" : summary.overdue ? "Overdued" : "Time Until Marked Overdue"}</span>
            {summary.timing !== null ? <strong role="timer" aria-live="off">{summary.timing}</strong> : null}</div>
        </div>
      </div>
    </section>
  );
}
