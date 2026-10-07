import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { Logger } from "pino";
import type { AppConfig } from "./config.js";
import { getPool, withTransaction } from "./db.js";
import { decryptPlatformTelegramBotToken } from "./security/telegram-secrets.js";
import { heartbeatDeadline, isHeartbeatOverdue } from "./services/heartbeat-deadline.js";
import { sendTelegramMessage, TelegramDeliveryError } from "./services/telegram.js";
import { lockTelegramDelivery, TELEGRAM_MIN_DELIVERY_GAP_MS } from "./services/telegram-delivery-state.js";
import { lockAgentAlerts } from "./services/alert-queue.js";
import { recordAgentCondition, resolveAgentCondition } from "./services/incidents.js";
import { purgeExpiredHistory, RETENTION_INTERVAL_MS } from "./services/retention.js";
import { agentAwaitingMaintenanceResume, agentInMaintenance, cancelMaintenanceNotifications } from "./services/maintenance.js";
import { processMaintenanceWindows } from "./services/maintenance-lifecycle.js";

interface StaleAgentRow extends RowDataPacket {
  id: string;
  public_id: string;
  project_id: string;
  server_name: string;
  project_name: string;
  last_heartbeat_at: string | null;
  created_at: string;
  heartbeat_interval_seconds: number;
}

interface OutboxRow extends RowDataPacket {
  id: string;
  agent_id: string;
}

interface PlatformTelegramRow extends RowDataPacket {
  telegram_bot_token_encrypted: string | null;
  telegram_chat_id: string | null;
}

export async function scanMissedHeartbeats(config: AppConfig): Promise<void> {
  const now = Date.now();
  const [rows] = await getPool(config).query<StaleAgentRow[]>(
    `SELECT a.id, a.public_id, a.project_id, a.server_name, a.last_heartbeat_at, a.created_at,
            p.name AS project_name, a.heartbeat_interval_seconds
     FROM agents a INNER JOIN projects p ON p.id = a.project_id
     WHERE a.is_delete = 0 AND p.is_delete = 0`
  );
  for (const agent of rows) {
    const baseline = Number(agent.last_heartbeat_at ?? agent.created_at);
    if (agent.last_heartbeat_at !== null && !isHeartbeatOverdue(now, baseline, Number(agent.heartbeat_interval_seconds))) continue;
    await withTransaction(config, async (connection) => {
      const current = await lockAgentAlerts(connection, agent.id);
      if (!current) return;
      const currentBaseline = Number(current.last_heartbeat_at ?? current.created_at);
      const overdue = isHeartbeatOverdue(now, currentBaseline, Number(current.heartbeat_interval_seconds));
      const identity = { agentInternalId: agent.id, agentPublicId: agent.public_id, serverName: agent.server_name,
        projectInternalId: agent.project_id, projectName: agent.project_name };
      if (!overdue) {
        if (current.last_heartbeat_at === null) await recordAgentCondition(connection, identity, {
          type: "awaiting_first_heartbeat", severity: "warning",
          probableCause: "Awaiting the agent's first heartbeat", details: {}
        }, now);
        return;
      }
      await resolveAgentCondition(connection, identity, "awaiting_first_heartbeat", now, false);
      await connection.execute(
        "UPDATE agents SET status = 'critical', probable_cause = 'Heartbeat overdue', updated_at = ? WHERE id = ?", [now, agent.id]
      );
      await recordAgentCondition(connection, identity, { type: "heartbeat_missed", severity: "critical",
        probableCause: "Heartbeat overdue", details: {
          last_heartbeat_at: current.last_heartbeat_at === null ? null : Number(current.last_heartbeat_at),
          due_at: heartbeatDeadline(currentBaseline, Number(current.heartbeat_interval_seconds))
        } }, now);
    });
  }
}
export function telegramText(payload: Record<string, unknown>): string {
  const severity = String(payload.severity ?? "recovery").toUpperCase();
  const serverName = String(payload.server_name ?? "Unknown server");
  const cause = String(payload.probable_cause ?? "Monitoring state changed");
  const projectName = String(payload.project_name ?? "Unknown project");
  const details = (payload.details ?? {}) as Record<string, unknown>;
  const diagnostics = [details.http_status_code == null ? null : `HTTP ${details.http_status_code}`,
    details.error_code, details.validation_error].filter(Boolean).join(" · ");
  const databaseDiagnostics = details.database_status == null ? "" : `DB ${details.database_status}${details.database_message ? `: ${details.database_message}` : ""}`;
  if (severity === "RECOVERY") {
    const type = String(payload.incident_type ?? "Monitoring condition");
    const labels: Record<string, string> = { ram_low: "RAM", disk_low: "Root Storage", load_high: "CPU Load",
      health_api_unhealthy: "Middleware API", database_not_alive: "Database", heartbeat_missed: "Heartbeat",
      apache_inactive: "Apache Availability", nginx_inactive: "Nginx Availability",
      apache_unknown: "Apache Status Detection", nginx_unknown: "Nginx Status Detection", telemetry_invalid: "Telemetry" };
    const recoveredCheck = labels[type] ?? type.replaceAll("_", " ");
    const remaining = Number(payload.remaining_open_incidents ?? 0);
    return `[RECOVERY] ${serverName}\nProject: ${projectName}\nRecovered Check: ${recoveredCheck}\n${remaining > 0 ? `Other Open Issues: ${remaining}. This agent still needs attention.` : "No other open issues are currently recorded."}`.slice(0, 4096);
  }
  return `[${severity}] ${serverName}\nProject: ${projectName}\nProbable cause: ${cause}${diagnostics ? `\nDetails: ${diagnostics}` : ""}${databaseDiagnostics ? `\nDatabase: ${databaseDiagnostics}` : ""}`.slice(0, 4096);
}

async function postponeTelegram(connection: PoolConnection, rowId: string, nextAttemptAt: number, now: number): Promise<void> {
  await connection.execute("UPDATE notification_outbox SET next_attempt_at = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND is_delete = 0", [nextAttemptAt, now, rowId]);
}

/** Delivers eligible queued notifications under per-agent and shared transport locks; never sends unnotified or superseded recoveries. */
export async function deliverTelegram(config: AppConfig): Promise<void> {
  const now = Date.now();
  const [settingsRows] = await getPool(config).execute<PlatformTelegramRow[]>(
    `SELECT telegram_bot_token_encrypted, telegram_chat_id
     FROM platform_telegram_settings
     WHERE scope_key = 'platform' AND is_delete = 0
     LIMIT 1`
  );
  const settings = settingsRows[0];
  if (!settings?.telegram_bot_token_encrypted || !settings.telegram_chat_id) return;
  const chatId = settings.telegram_chat_id;
  const botToken = decryptPlatformTelegramBotToken(
    config.jwt.secret,
    settings.telegram_bot_token_encrypted
  );

  const [rows] = await getPool(config).execute<OutboxRow[]>(
    `SELECT outbox.id, incident.agent_id
     FROM notification_outbox outbox
     INNER JOIN incidents incident ON incident.id = outbox.incident_id
     INNER JOIN agents agent ON agent.id = incident.agent_id
     WHERE outbox.channel = 'telegram' AND outbox.status = 'pending'
       AND (outbox.next_attempt_at <= ? OR (outbox.event_type = 'resolved' AND outbox.attempt_count = 0
         AND incident.resolved_at + agent.telegram_recovery_cooldown_seconds * 1000 <= ?)) AND outbox.is_delete = 0
       AND incident.is_delete = 0 AND agent.is_delete = 0
     ORDER BY (outbox.event_type = 'opened') DESC, outbox.id
     LIMIT 20`,
    [now, now]
  );

  for (const row of rows) {
    await withTransaction(config, async (connection) => {
      const currentAgent = await lockAgentAlerts(connection, row.agent_id);
      if (!currentAgent) return;
      if (await agentInMaintenance(connection, row.agent_id, Date.now())) {
        await cancelMaintenanceNotifications(connection, row.agent_id, Date.now());
        return;
      }
      if (await agentAwaitingMaintenanceResume(connection, row.agent_id, Date.now())) return;
      const deliveryNow = Date.now();
      // Lock and recheck after queue selection so cancellation and competing workers cannot reuse a stale row.
      const [pendingRows] = await connection.execute<RowDataPacket[]>(
        `SELECT o.incident_id, o.attempt_count, o.payload_json, o.event_type, o.next_attempt_at,
                i.status AS incident_status, i.incident_type, i.resolved_at FROM notification_outbox o
         INNER JOIN incidents i ON i.id = o.incident_id
         WHERE o.id = ? AND o.status = 'pending' AND o.is_delete = 0 AND i.is_delete = 0 FOR UPDATE`, [row.id]
      );
      if (!pendingRows[0]) return;
      const pending = pendingRows[0], recovery = pending.event_type === "resolved";
      if ((!recovery && pending.incident_status !== "open") || (recovery && pending.incident_status !== "resolved")) {
        await connection.execute("UPDATE notification_outbox SET status = 'cancelled', updated_at = ? WHERE id = ?", [deliveryNow, row.id]);
        return;
      }
      let remainingOpen = 0;
      if (recovery) {
        const [eligibility] = await connection.execute<RowDataPacket[]>(
          `SELECT EXISTS (SELECT 1 FROM notification_outbox WHERE incident_id = ? AND channel = 'telegram'
             AND event_type = 'opened' AND status = 'sent' AND is_delete = 0) AS issue_delivered,
           EXISTS (SELECT 1 FROM notification_outbox WHERE incident_id = ? AND channel = 'telegram'
             AND event_type = 'resolved' AND status = 'sent' AND is_delete = 0) AS recovery_delivered,
           EXISTS (SELECT 1 FROM incidents WHERE agent_id = ? AND incident_type = ? AND status = 'open' AND is_delete = 0) AS condition_reopened,
           (SELECT COUNT(*) FROM incidents WHERE agent_id = ? AND status = 'open' AND is_delete = 0) AS remaining_open`,
          [pending.incident_id, pending.incident_id, row.agent_id, pending.incident_type, row.agent_id]);
        const eligible = eligibility[0];
        if (!eligible || !Number(eligible.issue_delivered) || Number(eligible.recovery_delivered) || Number(eligible.condition_reopened)) {
          await connection.execute("UPDATE notification_outbox SET status = 'cancelled', last_error = 'Recovery is unnotified, duplicated or superseded', updated_at = ? WHERE id = ?", [deliveryNow, row.id]);
          return;
        }
        remainingOpen = Number(eligible.remaining_open);
      }
      const [sentRows] = await connection.execute<RowDataPacket[]>(
        `SELECT MAX(o.sent_at) AS last_sent_at FROM notification_outbox o INNER JOIN incidents i ON i.id = o.incident_id
         WHERE i.agent_id = ? AND o.channel = 'telegram' AND o.status = 'sent' AND o.event_type = ? AND o.is_delete = 0`, [row.agent_id, pending.event_type]);
      const cooldown = Number(recovery ? currentAgent.telegram_recovery_cooldown_seconds : currentAgent.telegram_alert_cooldown_seconds) * 1000;
      const sentAt = sentRows[0]?.last_sent_at;
      const earliest = Math.max(sentAt == null ? 0 : Number(sentAt) + cooldown, recovery ? Number(pending.resolved_at) + cooldown : 0);
      if (deliveryNow < earliest) { await postponeTelegram(connection, row.id, earliest, deliveryNow); return; }
      // Unattempted legacy recoveries may have been postponed by the former shared issue timer.
      if (Number(pending.next_attempt_at) > deliveryNow && !(recovery && Number(pending.attempt_count) === 0)) return;
      const transport = await lockTelegramDelivery(connection, deliveryNow);
      const transportDue = Math.max(Number(transport.next_delivery_at), Number(transport.blocked_until));
      if (deliveryNow < transportDue) { await postponeTelegram(connection, row.id, transportDue, deliveryNow); return; }
      const payload = typeof pending.payload_json === "string" ? JSON.parse(pending.payload_json) : pending.payload_json;
      if (recovery) payload.remaining_open_incidents = remainingOpen;
      let sendError: unknown;
      try {
        await sendTelegramMessage({
          botToken,
          chatId,
          text: telegramText(payload)
      });
    } catch (error) { sendError = error; }
    if (!sendError) {
      const completedAt = Date.now();
      await connection.execute(
        `UPDATE notification_outbox
         SET status = 'sent', sent_at = ?, updated_at = ?, last_error = NULL, destination = ?
         WHERE id = ?`,
        [completedAt, completedAt, chatId, row.id]
      );
      await connection.execute("UPDATE telegram_delivery_state SET next_delivery_at = ?, updated_at = ? WHERE scope_key = 'platform'", [completedAt + TELEGRAM_MIN_DELIVERY_GAP_MS, completedAt]);
    } else {
      const failedAt = Date.now();
      const attempts = Number(pending.attempt_count) + 1;
      const rateLimitError = sendError instanceof TelegramDeliveryError && sendError.statusCode === 429 ? sendError : null;
      const rateLimited = rateLimitError !== null;
      const failed = attempts >= 10 && !rateLimited;
      const retryMs = rateLimitError ? (rateLimitError.retryAfterSeconds ?? 60) * 1000 : Math.min(60 * 60 * 1000, 2 ** Math.min(attempts, 30) * 1000);
      const nextAttempt = failedAt + retryMs;
      await connection.execute("UPDATE telegram_delivery_state SET next_delivery_at = ?, blocked_until = GREATEST(blocked_until, ?), updated_at = ? WHERE scope_key = 'platform'",
        [failedAt + TELEGRAM_MIN_DELIVERY_GAP_MS, rateLimited ? nextAttempt : 0, failedAt]);
      await connection.execute(
        `UPDATE notification_outbox
         SET status = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
        [
          failed ? "failed" : "pending",
          attempts,
          nextAttempt,
          (sendError instanceof Error ? sendError.message : String(sendError)).slice(0, 500),
          failedAt,
          row.id
        ]
      );
    }
    });
  }
}

function recurringTask(
  name: string,
  intervalMs: number,
  logger: Logger,
  task: () => Promise<void>
): NodeJS.Timeout {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (error) {
      logger.error({ err: error, worker: name }, "Background worker failed");
    } finally { running = false; }
  };
  void run();
  return setInterval(run, intervalMs);
}

export function startWorkers(config: AppConfig, logger: Logger): () => void {
  const timers = [
    recurringTask("maintenance-transitions", 5_000, logger, () => processMaintenanceWindows(config)),
    recurringTask("heartbeat-expiry", 5_000, logger, () => scanMissedHeartbeats(config)),
    recurringTask("telegram-outbox", 10_000, logger, () => deliverTelegram(config)),
    recurringTask("history-retention", RETENTION_INTERVAL_MS, logger, () => purgeExpiredHistory(config, logger))
  ];
  return () => timers.forEach((timer) => clearInterval(timer));
}
