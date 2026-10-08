import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { SERVER_RESTART_INCIDENT_TYPE } from "../../shared/uptime.js";
import { queueTelegramNotification } from "./alert-queue.js";
import type { AgentIdentity } from "./incidents.js";

/**
 * Observes sequence-unique, validated uptime under the heartbeat's existing agent transaction lock.
 * Null, equal-time and older reports never replace the baseline or create restart events.
 * Each decrease appends a completed event and queues one issue-cadence notification, without recovery.
 * @param {PoolConnection} connection Caller-owned heartbeat transaction holding the agent lock.
 * @param {AgentIdentity} agent Authenticated agent and project identity.
 * @param {number|null} uptimeSeconds Canonical metrics.uptime_seconds from validated telemetry.
 * @param {number} observedAt Canonical telemetry observed_at, Unix milliseconds.
 * @param {number} receivedAt Central-server receipt time, Unix milliseconds.
 * @returns {Promise<void>} Persists the valid baseline and any one-off restart event atomically.
 */
export async function observeServerUptime(connection: PoolConnection, agent: AgentIdentity, uptimeSeconds: number | null,
  observedAt: number, receivedAt: number): Promise<void> {
  if (uptimeSeconds === null) return;
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT last_uptime_seconds, last_uptime_observed_at FROM agents WHERE id = ? AND is_delete = 0 FOR UPDATE`, [agent.agentInternalId]);
  const baseline = rows[0];
  if (!baseline || (baseline.last_uptime_observed_at != null && observedAt <= Number(baseline.last_uptime_observed_at))) return;
  const previous = baseline.last_uptime_seconds == null ? null : Number(baseline.last_uptime_seconds);
  await connection.execute(
    `UPDATE agents SET last_uptime_seconds = ?, last_uptime_observed_at = ?, last_uptime_received_at = ?, updated_at = ? WHERE id = ? AND is_delete = 0`,
    [String(uptimeSeconds), String(observedAt), String(receivedAt), receivedAt, agent.agentInternalId]);
  if (previous === null || baseline.last_uptime_observed_at == null || uptimeSeconds >= previous) return;

  const publicId = randomUUID();
  const cause = "Possible server restart: reported uptime decreased";
  const details = { previous_uptime_seconds: previous, current_uptime_seconds: uptimeSeconds,
    previous_observed_at: Number(baseline.last_uptime_observed_at), observed_at: observedAt };
  // This is a completed historical event, not a persistent health condition.
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO incidents (public_id, project_id, agent_id, incident_type, severity, status,
      probable_cause, details_json, opened_at, resolved_at, last_notification_at, created_at, updated_at, is_delete)
     VALUES (?, ?, ?, ?, 'warning', 'resolved', ?, ?, ?, ?, NULL, ?, ?, 0)`,
    [publicId, agent.projectInternalId, agent.agentInternalId, SERVER_RESTART_INCIDENT_TYPE, cause, JSON.stringify(details),
      receivedAt, receivedAt, receivedAt, receivedAt]);
  await queueTelegramNotification(connection, agent.projectInternalId, result.insertId, "opened", {
    incident_id: publicId, incident_type: SERVER_RESTART_INCIDENT_TYPE, project_name: agent.projectName,
    agent_id: agent.agentPublicId, server_name: agent.serverName, probable_cause: cause, severity: "warning", observed_at: observedAt, details
  }, receivedAt);
}
