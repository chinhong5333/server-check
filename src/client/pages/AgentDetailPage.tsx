import { hasPermission } from "../../shared/permissions";
import { ArrowLeft, CircleHelp, ExternalLink, Link2, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { DEFAULT_AGENT_CHECKS, type AgentChecks, type AgentHealthSnapshot, type AgentIncidentLog, type TelegramDeliverySummary } from "../../shared/contracts";
import { AgentHealthChecks } from "../components/AgentHealthChecks";
import { CopyButton } from "../components/CopyButton";
import { ManageAgentButton } from "../components/ManageAgentButton";
import { RotateAgentSecretButton } from "../components/RotateAgentSecretButton";
import type { AgentLatestResources, CapacitySnapshot } from "../../shared/contracts";
import { apiFetch } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { AgentIncidentHistory } from "../components/AgentIncidentHistory";
import { AgentHeartbeatSummary } from "../components/AgentHeartbeatSummary";
import { CHART_INTERVALS, useChartInterval } from "../hooks/useChartInterval";
import { TradingViewMetricChart } from "../components/TradingViewMetricChart";
import { AgentTelegramDeliveryLog } from "../components/AgentTelegramDeliveryLog";
import { EmptyState, ErrorState, PageSkeleton } from "../components/Feedback";
import { ModalDialog } from "../components/ModalDialog";
import { MetricValue } from "../components/MetricValue";
import { StatusBadge } from "../components/StatusBadge";
import { FAST_REFRESH_INTERVAL_MS, useApiResource } from "../hooks/useApiResource";
import {
  formatDateTime,
  formatCapacityPair,
  formatLatency,
  formatPercent,
  formatLoadAverage,
  utilizationFromAvailable
} from "../lib/format";

interface HistoryPoint {
  at: number;
  ram_available_percent: number | null;
  disk_available_percent: number | null;
  load_5: number | null;
  health_latency_ms: number | null;
  health_success_percent: number | null;
  ram_utilization_percent?: number | null;
  storage_utilization_percent?: number | null;
}

interface HistoryResponse {
  agent: {
    id: string;
    project_id: string;
    server_name: string;
    health_api_url: string | null;
    checks?: AgentChecks;
    service_health?: AgentHealthSnapshot | null;
    status: "new" | "healthy" | "warning" | "critical" | "stale";
    probable_cause: string | null;
    last_heartbeat_at: number | null;
    last_metrics_at: number | null;
    agent_version: string | null;
    heartbeat_interval_seconds: number;
    middleware_failure_count?: number;
    middleware_failure_threshold?: number;
  };
  from: number;
  to: number;
  bucket_seconds: number;
  points: HistoryPoint[];
  latest_load_5: number | null;
  latest_resources: AgentLatestResources;
}


const historyTabIds = ["incidents", "telegram"] as const;
type HistoryTabId = typeof historyTabIds[number];

const serverStateDefinitions = [
  {
    status: "new",
    description: "The agent is registered, but no heartbeat or metric report has been processed yet."
  },
  {
    status: "healthy",
    description: "The latest valid report passed all configured checks and the missing-heartbeat timeout has not elapsed. This reflects the last report, not continuous polling."
  },
  {
    status: "warning",
    description: "A resource threshold was reached, a web server's status is unknown, or a middleware failure is awaiting the configured consecutive-failure count."
  },
  {
    status: "critical",
    description: "A heartbeat is overdue, the middleware API has a confirmed unhealthy incident, or a monitored Apache/Nginx service is inactive."
  },
  {
    status: "stale",
    description: "The agent is online, but telemetry was missing or invalid in its latest report."
  }
] as const;

function latestMetricValue(data: HistoryPoint[], dataKey: keyof HistoryPoint): number | null {
  let latest: { at: number; value: number } | null = null;
  for (const point of data) {
    const value = point[dataKey];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (!latest || point.at > latest.at) latest = { at: point.at, value };
  }
  return latest?.value ?? null;
}

function MetricChart({
  title,
  data,
  dataKey,
  formatter,
  latestReading,
  capacity,
  agentId
}: {
  title: string;
  data: HistoryPoint[];
  dataKey: keyof HistoryPoint;
  formatter: (value: number | null | undefined) => string;
  latestReading?: number | null;
  capacity?: CapacitySnapshot | null;
  agentId: string;
}) {
  const chart = useChartInterval<HistoryPoint>(agentId, data);
  const chartData = useMemo(() => chart.points?.map(point => ({ ...point,
    ram_utilization_percent: utilizationFromAvailable(point.ram_available_percent),
    storage_utilization_percent: utilizationFromAvailable(point.disk_available_percent)
  })) ?? [], [chart.points]);
  const tradingPoints = useMemo(() => chartData.map(point => ({ at: point.at, value: point[dataKey] })), [chartData, dataKey]);
  const latestValue = latestReading === undefined ? latestMetricValue(data, dataKey) : latestReading;
  return (
    <section className="chart-surface">
      <div className="section-heading">
        <div className="chart-heading-copy">
          <div className="chart-heading-title"><h2>{title}</h2>
        <div className="chart-interval-control" role="group" aria-label={`${title} Interval`}>
          {CHART_INTERVALS.map(option => <button key={option.seconds} type="button"
            aria-label={option.label} aria-pressed={chart.interval === option.seconds}
            onClick={() => chart.setInterval(option.seconds)}>
            {option.seconds === 3600 ? "1h" : `${option.seconds / 60}m`}
          </button>)}
        </div>
        </div>
        </div>
        <div className="chart-readings">
          <div className="chart-latest" aria-label={`Latest Value for ${title}`}>
            <span>Latest Value</span>
            <MetricValue value={latestValue} format={formatter} className="chart-latest__value" />
          </div>
          {capacity && <div className="chart-capacity"><span>Used / Total</span><span className="numeric">{formatCapacityPair(capacity.used_bytes, capacity.total_bytes)}</span></div>}
        </div>
      </div>
      <div className="chart-body">
      {chart.error ? <div className="chart-feedback" role="status"><p>{chart.error}</p><button className="button button--secondary" type="button" onClick={chart.retry}>Retry Chart</button></div> : null}
      {chart.points === null ? <div className="chart chart-feedback" role="status">{chart.error ? "Chart Unavailable" : "Loading Chart…"}</div>
        : chartData.length === 0 ? <div className="chart chart-feedback" role="status">No Data For This Interval</div> :
          <TradingViewMetricChart key={chart.interval} title={title}
            points={tradingPoints} formatter={formatter} />}
      </div>
    </section>
  );
}

export function AgentDetailPage() {
  const alignChartHeaders = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const headers = [...node.querySelectorAll<HTMLElement>(".chart-surface > .section-heading")];
    const align = () => {
      const height = Math.max(0, ...headers.map(header => {
        const style = getComputedStyle(header);
        const top = header.getBoundingClientRect().top;
        const bottom = Math.max(top, ...[...header.children].map(child => child.getBoundingClientRect().bottom));
        return bottom - top + parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth);
      }));
      node.style.setProperty("--chart-header-height", `${Math.ceil(height)}px`);
    };
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(align);
    for (const header of headers) for (const child of header.children) observer.observe(child);
    align();
    return () => observer.disconnect();
  }, []);
  const { user } = useAuth();
  const { agentId, projectId } = useParams<{ agentId: string; projectId: string }>();
  const [activeHistoryTab, setActiveHistoryTab] = useState<HistoryTabId>("incidents");
  const [serverStateHelpOpen, setServerStateHelpOpen] = useState(false);
  const serverStateHelpTriggerRef = useRef<HTMLButtonElement>(null);
  const load = useCallback(
    () => {
      const to = Date.now();
      const from = to - 7 * 24 * 60 * 60 * 1000;
      return apiFetch<HistoryResponse>(
        `/api/v1/agents/${agentId}/history?from=${from}&to=${to}&bucket_seconds=1800`
      );
    },
    [agentId]
  );
  const resource = useApiResource<HistoryResponse>(`history:${agentId}`, load, {
    refreshIntervalMs: FAST_REFRESH_INTERVAL_MS
  });
  const loadIncidents = useCallback(
    () => apiFetch<AgentIncidentLog[]>(`/api/v1/agents/${agentId}/incidents`),
    [agentId]
  );
  const incidents = useApiResource<AgentIncidentLog[]>(`agent-incidents:${agentId}`, loadIncidents, {
    refreshIntervalMs: FAST_REFRESH_INTERVAL_MS
  });
  const loadTelegramDeliveries = useCallback(
    () => apiFetch<TelegramDeliverySummary[]>(`/api/v1/agents/${agentId}/telegram-deliveries`),
    [agentId]
  );
  const telegramDeliveries = useApiResource<TelegramDeliverySummary[]>(
    `agent-telegram-deliveries:${agentId}`,
    loadTelegramDeliveries,
    { refreshIntervalMs: FAST_REFRESH_INTERVAL_MS }
  );

  if (resource.status === "loading") return <PageSkeleton rows={8} />;
  if (resource.status === "error") {
    return <ErrorState title="Couldn't Load Server History" message={resource.error?.message ?? "Try again."} onRetry={resource.reload} />;
  }
  if (!resource.data) {
    return (
      <ErrorState
        title="Couldn't Load Server History"
        message="The agent history response was empty."
        onRetry={resource.reload}
      />
    );
  }

  const overviewHref = `/projects/${encodeURIComponent(
    resource.data.agent.project_id || projectId || ""
  )}`;
  const displayPoints = resource.data.points.map((point) => ({
    ...point,
    ram_utilization_percent: utilizationFromAvailable(point.ram_available_percent),
    storage_utilization_percent: utilizationFromAvailable(point.disk_available_percent)
  }));
  const agent = resource.data.agent;
  const selectHistoryTab = (tabId: HistoryTabId) => {
    setActiveHistoryTab(tabId);
    queueMicrotask(() => document.getElementById(`agent-history-tab-${tabId}`)?.focus());
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTab: HistoryTabId) => {
    const currentIndex = historyTabIds.indexOf(currentTab);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % historyTabIds.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + historyTabIds.length) % historyTabIds.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = historyTabIds.length - 1;
    else return;
    event.preventDefault();
    selectHistoryTab(historyTabIds[nextIndex]);
  };

  return (
    <div className="page-stack">
      <div className="agent-page-intro">
      <Link className="back-link" to={overviewHref}>
        <ArrowLeft aria-hidden="true" />
        Overview
      </Link>
      <header className="page-header">
        <div>
          <p className="page-context">Agent Detail</p>
          <h1>{agent.server_name}</h1>
          <p>Current status, seven-day metric trends, and historical records for this monitored server.</p>
        </div>
        {(hasPermission(user, "edit_agent_settings") || hasPermission(user, "rotate_agent_secrets")) && <div className="agent-detail-actions">
          {hasPermission(user, "edit_agent_settings") && <ManageAgentButton agentId={agent.id} projectId={agent.project_id} agentName={agent.server_name} onSaved={resource.reload} />}
          {hasPermission(user, "rotate_agent_secrets") && <RotateAgentSecretButton agentId={agent.id} projectId={agent.project_id} agentName={agent.server_name}
            checks={agent.checks} healthApiUrl={agent.health_api_url} onFinished={resource.reload} />}
        </div>}
      </header>
      </div>

      <AgentHeartbeatSummary agent={agent} help={
          <button
            ref={serverStateHelpTriggerRef}
            className="icon-button"
            type="button"
            aria-label="View Server State Definitions"
            title="View Server State Definitions"
            aria-haspopup="dialog"
            aria-controls="server-state-definitions"
            onClick={() => setServerStateHelpOpen(true)}
          >
            <CircleHelp aria-hidden="true" />
          </button>
      } />

      <ModalDialog
        id="server-state-definitions"
        open={serverStateHelpOpen}
        labelledBy="server-state-definitions-title"
        describedBy="server-state-definitions-description"
        surfaceClassName="agent-dialog__surface form-surface"
        restoreFocusTo={serverStateHelpTriggerRef.current}
      >
        <div className="section-heading">
          <div>
            <h2 id="server-state-definitions-title">Server State Definitions</h2>
            <p id="server-state-definitions-description">How Server Check classifies the current condition of an agent.</p>
          </div>
          <button
            className="icon-button"
            type="button"
            data-dialog-initial-focus
            aria-label="Close Server State Definitions"
            onClick={() => setServerStateHelpOpen(false)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <ul className="server-state-reference">
          {serverStateDefinitions.map((definition) => (
            <li key={definition.status}>
              <StatusBadge status={definition.status} />
              <p>{definition.description}</p>
            </li>
          ))}
        </ul>
      </ModalDialog>

      <AgentHealthChecks checks={agent.checks ?? DEFAULT_AGENT_CHECKS} snapshot={agent.service_health ?? null}
        lastMetricsAt={agent.last_metrics_at} lastHeartbeatAt={agent.last_heartbeat_at}
        intervalSeconds={agent.heartbeat_interval_seconds} telemetryStale={agent.status === "stale"} />

      <section className="agent-script-configuration" aria-labelledby="latest-script-configuration-title">
        <div>
          <h2 id="latest-script-configuration-title">Latest Script Configuration</h2>
          <p>Middleware endpoint used by the latest generated script.</p>
        </div>
        <dl>
          <div>
            <dt><Link2 aria-hidden="true" /> Middleware API URL</dt>
            <dd className="script-url-row">{agent.health_api_url ? <>
              <code>{agent.health_api_url}</code>
              <span className="script-url-actions">
                <CopyButton value={agent.health_api_url} label="Copy" />
                <a className="button button--secondary" href={agent.health_api_url} target="_blank" rel="noopener noreferrer"
                  aria-label="Test Middleware API URL In A New Tab" title="Open In A New Tab"><ExternalLink aria-hidden="true" />Test</a>
              </span>
            </> : "Not Monitored"}</dd>
          </div>
        </dl>
      </section>

      {resource.data.points.length === 0 ? (
        <EmptyState
          title="No Metric History Yet"
          message="The agent has not delivered a valid telemetry sample in this range."
        />
      ) : (
        <div className="chart-grid" ref={alignChartHeaders}>
          <MetricChart agentId={agent.id} key={`${agent.id}:ram_utilization_percent`} title="RAM Utilization" data={displayPoints} dataKey="ram_utilization_percent" formatter={formatPercent}
            latestReading={resource.data.latest_resources?.ram?.utilization_percent ?? null} capacity={resource.data.latest_resources?.ram} />
          <MetricChart agentId={agent.id} key={`${agent.id}:storage_utilization_percent`} title="Storage Utilization" data={displayPoints} dataKey="storage_utilization_percent" formatter={formatPercent}
            latestReading={resource.data.latest_resources?.storage?.utilization_percent ?? null} capacity={resource.data.latest_resources?.storage} />
          <MetricChart agentId={agent.id} key={`${agent.id}:load_5`} title="Load Average (5 Min)" data={displayPoints} dataKey="load_5" formatter={formatLoadAverage} latestReading={resource.data.latest_load_5 ?? null} />
          <MetricChart agentId={agent.id} key={`${agent.id}:health_latency_ms`} title="Health Latency" data={displayPoints} dataKey="health_latency_ms" formatter={formatLatency} />
        </div>
      )}

      <section className="history-tabs" aria-labelledby="agent-history-records-title">
        <div className="history-tabs__heading">
          <h2 id="agent-history-records-title">History Records</h2>
        </div>
        <div className="history-tabs__list" role="tablist" aria-label="Agent History Records">
          <button
            id="agent-history-tab-incidents"
            className="history-tabs__tab"
            type="button"
            role="tab"
            aria-selected={activeHistoryTab === "incidents"}
            aria-controls="agent-history-panel-incidents"
            tabIndex={activeHistoryTab === "incidents" ? 0 : -1}
            onClick={() => selectHistoryTab("incidents")}
            onKeyDown={(event) => handleTabKeyDown(event, "incidents")}
          >
            Incident History
            {incidents.status === "success" ? <span className="numeric">{incidents.data?.length ?? 0}</span> : null}
          </button>
          <button
            id="agent-history-tab-telegram"
            className="history-tabs__tab"
            type="button"
            role="tab"
            aria-selected={activeHistoryTab === "telegram"}
            aria-controls="agent-history-panel-telegram"
            tabIndex={activeHistoryTab === "telegram" ? 0 : -1}
            onClick={() => selectHistoryTab("telegram")}
            onKeyDown={(event) => handleTabKeyDown(event, "telegram")}
          >
            Telegram Delivery Log
            {telegramDeliveries.status === "success" ? <span className="numeric">{telegramDeliveries.data?.length ?? 0}</span> : null}
          </button>
        </div>

        {activeHistoryTab === "incidents" ? (
          <div id="agent-history-panel-incidents" role="tabpanel" aria-labelledby="agent-history-tab-incidents" tabIndex={0}>
            {incidents.status === "loading" ? <PageSkeleton rows={4} /> : null}
            {incidents.status === "error" ? (
              <ErrorState title="Couldn't Load Agent Incidents" message={incidents.error?.message ?? "Try again."} onRetry={incidents.reload} />
            ) : null}
            {incidents.status === "success" ? <AgentIncidentHistory incidents={incidents.data ?? []} /> : null}
          </div>
        ) : (
          <div id="agent-history-panel-telegram" role="tabpanel" aria-labelledby="agent-history-tab-telegram" tabIndex={0}>
            {telegramDeliveries.status === "loading" ? <PageSkeleton rows={4} /> : null}
            {telegramDeliveries.status === "error" ? (
              <ErrorState title="Couldn't Load Telegram Delivery Log" message={telegramDeliveries.error?.message ?? "Try again."} onRetry={telegramDeliveries.reload} />
            ) : null}
            {telegramDeliveries.status === "success" ? <AgentTelegramDeliveryLog deliveries={telegramDeliveries.data ?? []}
              cancellation={hasPermission(user, "edit_agent_settings") ? { agentId: resource.data.agent.id, agentName: resource.data.agent.server_name, onCancelled: telegramDeliveries.reload } : undefined} /> : null}
          </div>
        )}
      </section>
    </div>
  );
}
