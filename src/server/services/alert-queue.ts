import { createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

/** Serializes collection, recovery, cancellation, and delivery for one active agent. */
export async function lockAgentAlerts(connection: PoolConnection, agentId: string): Promise<RowDataPacket | undefined> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id, last_heartbeat_at, created_at, heartbeat_interval_seconds, telegram_alert_cooldown_seconds
     FROM agents WHERE id = ? AND is_delete = 0 FOR UPDATE`, [agentId]
  );
  return rows[0];
}

/** Stable error identity excludes changing timestamps, latency, and metric readings. */
export function alertKey(eventType: "opened" | "resolved", payload: Record<string, unknown>): string {
  const details = (payload.details ?? {}) as Record<string, unknown>;
  return createHash("sha256").update(JSON.stringify([
    eventType, payload.incident_type ?? null, payload.probable_cause ?? null,
    details.error_code ?? null, details.http_status_code ?? null, details.service_name ?? null,
    details.mount_point ?? null, details.validation_error ?? null
  ])).digest("hex");
}

/**
 * Collects a notification without applying delivery cooldown. Caller must hold the agent row lock.
 * Existing identical pending messages are refreshed, never duplicated or rescheduled.
 * @param {PoolConnection} connection Caller-owned transaction holding the agent lock.
 * @param {string} projectId Internal project identifier.
 * @param {string|number} incidentId Internal incident identifier.
 * @param {"opened"|"resolved"} eventType Alert/reminder or recovery.
 * @param {Record<string, unknown>} payload Canonical notification details, excluding credentials.
 * @param {number} now Server Unix timestamp in milliseconds.
 * @returns {Promise<void>} Persists or refreshes one pending notification.
 */
export async function queueTelegramNotification(connection: PoolConnection, projectId: string, incidentId: string | number,
  eventType: "opened" | "resolved", payload: Record<string, unknown>, now: number): Promise<void> {
  if (eventType === "resolved") await cancelIncidentAlerts(connection, incidentId, now);
  const key = alertKey(eventType, payload);
  const [pending] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM notification_outbox WHERE incident_id = ? AND channel = 'telegram'
     AND event_type = ? AND status = 'pending' AND is_delete = 0
     AND (alert_key = ? OR alert_key IS NULL) ORDER BY id LIMIT 1 FOR UPDATE`, [incidentId, eventType, key]
  );
  if (pending[0]) {
    await connection.execute("UPDATE notification_outbox SET payload_json = ?, alert_key = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(payload), key, now, pending[0].id]);
    return;
  }
  await connection.execute(
    `INSERT INTO notification_outbox
      (project_id, incident_id, channel, event_type, destination, payload_json, alert_key,
       status, attempt_count, next_attempt_at, sent_at, last_error, created_at, updated_at, is_delete)
     VALUES (?, ?, 'telegram', ?, NULL, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?, 0)`,
    [projectId, incidentId, eventType, JSON.stringify(payload), key, now, now, now]
  );
}

/** Retains obsolete queued alerts as cancelled logs when a condition recovers or is superseded. */
export async function cancelIncidentAlerts(connection: PoolConnection, incidentId: string | number, now: number): Promise<void> {
  await connection.execute(
    `UPDATE notification_outbox SET status = 'cancelled', last_error = NULL, updated_at = ?
     WHERE incident_id = ? AND channel = 'telegram' AND event_type = 'opened' AND status = 'pending' AND is_delete = 0`, [now, incidentId]
  );
}
