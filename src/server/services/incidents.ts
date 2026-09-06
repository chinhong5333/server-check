import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { TelemetryPayload } from "../../shared/contracts.js";

interface AgentPolicy {
  agentInternalId: string;
  agentPublicId: string;
  serverName: string;
  projectInternalId: string;
  projectName: string;
  ramThreshold: number;
  diskThreshold: number;
  loadThreshold: number;
}

interface OpenIncidentRow extends RowDataPacket {
  id: string;
  public_id: string;
  incident_type: string;
}

interface Condition {
  type: string;
  severity: "warning" | "critical";
  probableCause: string;
  details: Record<string, unknown>;
}

export interface DiagnosticSnapshot {
  ramAvailablePercent: number | null;
  diskAvailablePercent: number | null;
  load5PerCore: number | null;
  status: "healthy" | "warning" | "critical";
  probableCause: string | null;
}

function calculateSnapshot(payload: TelemetryPayload): Omit<DiagnosticSnapshot, "status" | "probableCause"> {
  const memoryTotal = payload.metrics.memory_total_bytes;
  const memoryAvailable = payload.metrics.memory_available_bytes;
  const ramAvailablePercent =
    memoryTotal && memoryAvailable !== null ? (memoryAvailable / memoryTotal) * 100 : null;

  const availablePercentages = payload.filesystems
    .filter((filesystem) => filesystem.total_bytes > 0)
    .map((filesystem) => (filesystem.available_bytes / filesystem.total_bytes) * 100);
  const diskAvailablePercent =
    availablePercentages.length > 0 ? Math.min(...availablePercentages) : null;

  const load5PerCore =
    payload.metrics.load_5 !== null && payload.metrics.cpu_count
      ? payload.metrics.load_5 / payload.metrics.cpu_count
      : null;

  return { ramAvailablePercent, diskAvailablePercent, load5PerCore };
}

function conditionsForPayload(
  policy: AgentPolicy,
  payload: TelemetryPayload,
  snapshot: ReturnType<typeof calculateSnapshot>
): Condition[] {
  const conditions: Condition[] = [];

  if (
    snapshot.ramAvailablePercent !== null &&
    snapshot.ramAvailablePercent < policy.ramThreshold
  ) {
    conditions.push({
      type: "ram_low",
      severity: "warning",
      probableCause: "Available RAM is below the project threshold",
      details: {
        available_percent: snapshot.ramAvailablePercent,
        threshold_percent: policy.ramThreshold
      }
    });
  }

  if (
    snapshot.diskAvailablePercent !== null &&
    snapshot.diskAvailablePercent < policy.diskThreshold
  ) {
    const filesystem = payload.filesystems
      .filter((item) => item.total_bytes > 0)
      .sort(
        (left, right) =>
          left.available_bytes / left.total_bytes - right.available_bytes / right.total_bytes
      )[0];
    conditions.push({
      type: "disk_low",
      severity: "warning",
      probableCause: `Storage is low on ${filesystem?.mount_point ?? "a monitored filesystem"}`,
      details: {
        available_percent: snapshot.diskAvailablePercent,
        threshold_percent: policy.diskThreshold,
        mount_point: filesystem?.mount_point ?? null
      }
    });
  }

  if (snapshot.load5PerCore !== null && snapshot.load5PerCore >= policy.loadThreshold) {
    conditions.push({
      type: "load_high",
      severity: "warning",
      probableCause: "Five-minute load per CPU core is above the project threshold",
      details: {
        load_5_per_core: snapshot.load5PerCore,
        threshold: policy.loadThreshold
      }
    });
  }

  if (payload.health_probe.outcome === "unhealthy") {
    conditions.push({
      type: "health_api_unhealthy",
      severity: "critical",
      probableCause: "The middleware API did not return HTTP 200",
      details: {
        http_status_code: payload.health_probe.http_status_code,
        error_code: payload.health_probe.error_code,
        latency_ms: payload.health_probe.latency_ms
      }
    });
  }

  for (const name of ["apache", "nginx"] as const) {
    const service = payload.service_checks[name];
    if (!service || service.status === "disabled" || service.status === "active") continue;
    conditions.push({
      type: `${name}_${service.status}`,
      severity: service.status === "inactive" ? "critical" : "warning",
      probableCause: service.status === "inactive" ? `${service.service_name} is inactive` : `Unable to determine ${name === "apache" ? "Apache" : "Nginx"} service status`,
      details: { service_name: service.service_name, service_status: service.status }
    });
  }

  return conditions;
}

async function queueNotification(
  connection: PoolConnection,
  projectInternalId: string,
  incidentInternalId: string | number,
  eventType: "opened" | "resolved",
  payload: Record<string, unknown>,
  now: number
): Promise<void> {
  await connection.execute(
    `INSERT INTO notification_outbox
      (project_id, incident_id, channel, event_type, destination, payload_json,
       status, attempt_count, next_attempt_at, sent_at, last_error,
       created_at, updated_at, is_delete)
     VALUES (?, ?, 'telegram', ?, NULL, ?, 'pending', 0, ?, NULL, NULL, ?, ?, 0)`,
    [projectInternalId, incidentInternalId, eventType, JSON.stringify(payload), now, now, now]
  );
}

export async function evaluateTelemetryIncidents(
  connection: PoolConnection,
  policy: AgentPolicy,
  payload: TelemetryPayload,
  now: number
): Promise<DiagnosticSnapshot> {
  const snapshot = calculateSnapshot(payload);
  const conditions = conditionsForPayload(policy, payload, snapshot);
  const [openRows] = await connection.execute<OpenIncidentRow[]>(
    `SELECT id, public_id, incident_type
     FROM incidents
     WHERE agent_id = ? AND status = 'open' AND is_delete = 0`,
    [policy.agentInternalId]
  );
  const openByType = new Map(openRows.map((incident) => [incident.incident_type, incident]));
  // An indeterminate probe is not evidence that an existing outage recovered.
  for (const name of ["apache", "nginx"] as const) {
    const service = payload.service_checks[name];
    if (service?.status === "unknown" && openByType.has(`${name}_inactive`)) {
      conditions.push({ type: `${name}_inactive`, severity: "critical",
        probableCause: `${service.service_name} status is unknown; previous outage recovery is unconfirmed`,
        details: { service_name: service.service_name, service_status: "unknown" } });
    }
  }
  const activeTypes = new Set(conditions.map((condition) => condition.type));

  for (const condition of conditions) {
    if (openByType.has(condition.type)) continue;
    const publicId = randomUUID();
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO incidents
        (public_id, project_id, agent_id, incident_type, severity, status,
         probable_cause, details_json, opened_at, resolved_at, last_notification_at,
         created_at, updated_at, is_delete)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, NULL, NULL, ?, ?, 0)`,
      [
        publicId,
        policy.projectInternalId,
        policy.agentInternalId,
        condition.type,
        condition.severity,
        condition.probableCause,
        JSON.stringify(condition.details),
        now,
        now,
        now
      ]
    );
    await queueNotification(
      connection,
      policy.projectInternalId,
      result.insertId,
      "opened",
      {
        incident_id: publicId,
        project_name: policy.projectName,
        agent_id: policy.agentPublicId,
        server_name: policy.serverName,
        probable_cause: condition.probableCause,
        severity: condition.severity,
        opened_at: now,
        details: condition.details
      },
      now
    );
  }

  for (const incident of openRows) {
    if (incident.incident_type === "heartbeat_missed" || activeTypes.has(incident.incident_type)) {
      continue;
    }
    await connection.execute(
      `UPDATE incidents
       SET status = 'resolved', resolved_at = ?, updated_at = ?
       WHERE id = ?`,
      [now, now, incident.id]
    );
    await queueNotification(
      connection,
      policy.projectInternalId,
      incident.id,
      "resolved",
      {
        incident_id: incident.public_id,
        project_name: policy.projectName,
        agent_id: policy.agentPublicId,
        server_name: policy.serverName,
        resolved_at: now
      },
      now
    );
  }

  const primary = conditions.sort((left, right) => {
    if (left.severity === right.severity) return 0;
    return left.severity === "critical" ? -1 : 1;
  })[0];

  return {
    ...snapshot,
    status: primary?.severity ?? "healthy",
    probableCause: primary?.probableCause ?? null
  };
}

export async function resolveHeartbeatIncident(
  connection: PoolConnection,
  policy: Pick<
    AgentPolicy,
    "agentInternalId" | "agentPublicId" | "serverName" | "projectInternalId" | "projectName"
  >,
  now: number
): Promise<void> {
  const [rows] = await connection.execute<OpenIncidentRow[]>(
    `SELECT id, public_id, incident_type
     FROM incidents
     WHERE agent_id = ? AND incident_type = 'heartbeat_missed'
       AND status = 'open' AND is_delete = 0
     LIMIT 1`,
    [policy.agentInternalId]
  );
  const incident = rows[0];
  if (!incident) return;

  await connection.execute(
    "UPDATE incidents SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE id = ?",
    [now, now, incident.id]
  );
  await queueNotification(
    connection,
    policy.projectInternalId,
    incident.id,
    "resolved",
    {
      incident_id: incident.public_id,
      project_name: policy.projectName,
      agent_id: policy.agentPublicId,
      server_name: policy.serverName,
      probable_cause: "Heartbeat delivery recovered",
      resolved_at: now
    },
    now
  );
}
