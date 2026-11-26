import { AlertTriangle, CircleX } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { formatDateTime, formatTime, serverUptimeText } from "../lib/format";
import { statusClock } from "../lib/status-clock";
import { heartbeatDuration, heartbeatSummary, statusNotice, type SummaryAgent } from "./AgentHeartbeatSummary";
import { StatusBadge } from "./StatusBadge";
import { t } from "../i18n";

const SEGMENTS = 20;

/** Square-segment meter, 5% per square. Decorative: the tile's text carries the exact value. */
function SegmentMeter({ fraction }: { fraction: number }) {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * SEGMENTS);
  return <span className="agent-reading__segments" aria-hidden="true">
    {Array.from({ length: SEGMENTS }, (_, index) => <i key={index} className={index < filled ? "is-on" : undefined} />)}
  </span>;
}

/** Compact clock text for the countdown ring: m:ss, or h:mm:ss from one hour. */
function clockText(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** One latest-reading tile of the Ver 2 layout: a value with either a utilization meter or a short trend line. */
export function ReadingTile({ label, value, series, percent, detail, trend }: {
  label: string; value: string; series: "ram" | "storage" | "load" | "latency";
  percent?: number | null; detail?: string | null; trend?: Array<number | null | undefined>;
}) {
  const values = (trend ?? []).filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  const low = Math.min(...values);
  const span = Math.max(...values) - low;
  // Fewer than two readings, or readings that never change, draw a flat line through the middle,
  // so every trend tile keeps the same shape and position.
  const points = values.length > 1 && span > 0
    ? values.map((item, index) => `${(index / (values.length - 1)) * 100},${22 - ((item - low) / span) * 20}`).join(" ")
    : "0,12 100,12";
  return <article className="agent-reading" data-series={series} aria-label={label}>
    <span className="agent-reading__label">{label}</span>
    <strong className="agent-reading__value numeric">{value}</strong>
    {percent != null ? <SegmentMeter fraction={percent / 100} /> : null}
    {trend ? <svg className="agent-reading__spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} />
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
  const ringGradientId = `heartbeat-ring-${useId().replace(/[^\w-]/g, "")}`;
  // A later deadline means a new heartbeat arrived. Detected during render, so the refill easing and the
  // "beat" (ripple, centre pop, glow) land in the same frame as the new, fuller arc instead of a jump.
  const [previousDeadline, setPreviousDeadline] = useState(summary.deadline);
  const [beat, setBeat] = useState(0);
  if (summary.deadline !== previousDeadline) {
    setPreviousDeadline(summary.deadline);
    if (previousDeadline !== null && summary.deadline !== null && summary.deadline > previousDeadline) setBeat((count) => count + 1);
  }
  const [refilling, setRefilling] = useState(false);
  useEffect(() => {
    if (beat === 0) return;
    setRefilling(true);
    const timer = window.setTimeout(() => setRefilling(false), 900);
    return () => window.clearTimeout(timer);
  }, [beat]);
  const ringState = summary.overdue ? " agent-reading__ring--overdue" : remaining <= 0.25 ? " agent-reading__ring--low" : "";
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
      <article className={`agent-reading agent-reading--ring${summary.overdue ? " agent-reading--overdue" : ""}`} data-series="heartbeat" aria-label={t("Last Heartbeat Received")}>
        <span className="agent-reading__label">{t("Last Heartbeat Received")}</span>
        <strong className="agent-reading__value">{summary.elapsed}</strong>
        <p title={summary.deadline === null ? undefined : t("Marked Overdue At: {0}", formatDateTime(summary.deadline))}>
          {summary.deadline === null ? t("A deadline starts after the first heartbeat.")
            : summary.overdue ? <>{t("Overdued")}{" "}<strong>{summary.timing}</strong></>
              : <>{t("Marked Overdue At")}{" "}<strong>{formatTime(summary.deadline)}</strong></>}
        </p>
        {/* Countdown ring: drains toward the overdue point; once overdue it turns red and counts up. */}
        {/* Each tick glides into the next second; a new heartbeat sweeps the arc back to full with a single beat. */}
        {summary.deadline !== null ? <span
          className={`agent-reading__ring${ringState}${refilling ? " agent-reading__ring--refilling" : ""}`}
          role="timer" aria-live="off" aria-label={`${summary.overdue ? t("Overdued") : t("Time Until Marked Overdue")} ${summary.timing}`}>
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <defs>
              <linearGradient id={ringGradientId} x1="0" y1="0" x2="1" y2="1">
                <stop className="agent-reading__ring-stop" offset="0" stopOpacity="0.35" />
                <stop className="agent-reading__ring-stop" offset="1" />
              </linearGradient>
            </defs>
            {beat > 0 ? <circle key={`ripple-${beat}`} className="agent-reading__ring-ripple" cx="24" cy="24" r="20" /> : null}
            <circle key={`disc-${beat}`} className={`agent-reading__ring-disc${beat > 0 ? " is-beat" : ""}`} cx="24" cy="24" r="15" />
            <circle className="agent-reading__ring-track" cx="24" cy="24" r="20" />
            <circle className="agent-reading__ring-fill" cx="24" cy="24" r="20" pathLength="100" transform="rotate(-90 24 24)"
              stroke={`url(#${ringGradientId})`} style={{ strokeDasharray: `${remaining * 100} 100` }} />
            <g className="agent-reading__ring-knob-group" style={{ transform: `rotate(${remaining * 360}deg)` }}>
              <circle className="agent-reading__ring-halo" cx="24" cy="4" r="6" />
              <circle className="agent-reading__ring-knob" cx="24" cy="4" r="3.4" />
            </g>
          </svg>
          <span key={`centre-${beat}`} className={beat > 0 ? "is-beat" : undefined} aria-hidden="true">
            <strong>{summary.overdue ? `+${clockText(asOf - summary.deadline)}` : clockText(summary.deadline - asOf)}</strong>
            <small>{summary.overdue ? t("Late") : t("Left")}</small>
          </span>
        </span> : null}
      </article>
      {readings}
    </div>
  </section>;
}
