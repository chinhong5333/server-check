import type { RowDataPacket } from "mysql2/promise";
import type { Logger } from "pino";
import type { AppConfig } from "./config.js";
import { getPool, withTransaction } from "./db.js";
import { decryptPlatformTelegramBotToken } from "./security/telegram-secrets.js";
import { heartbeatDeadline, isHeartbeatOverdue } from "./services/heartbeat-deadline.js";
import { sendTelegramMessage } from "./services/telegram.js";
import { lockAgentAlerts } from "./services/alert-queue.js";
import { recordAgentCondition, resolveAgentCondition } from "./services/incidents.js";
import { purgeExpiredHistory, RETENTION_INTERVAL_MS } from "./services/retention.js";

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
  return `[${severity}] ${serverName}\nProject: ${projectName}\nProbable cause: ${cause}${diagnostics ? `\nDetails: ${diagnostics}` : ""}`.slice(0, 4096);
}

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
       AND outbox.next_attempt_at <= ? AND outbox.is_delete = 0
       AND incident.is_delete = 0 AND agent.is_delete = 0
     ORDER BY outbox.id
     LIMIT 20`,
    [now]
  );

  for (const row of rows) {
    await withTransaction(config, async (connection) => {
      const currentAgent = await lockAgentAlerts(connection, row.agent_id);
      if (!currentAgent) return;
      const [sentRows] = await connection.execute<RowDataPacket[]>(
        `SELECT MAX(o.sent_at) AS last_sent_at FROM notification_outbox o
         INNER JOIN incidents i ON i.id = o.incident_id
         WHERE i.agent_id = ? AND o.channel = 'telegram' AND o.status = 'sent' AND o.is_delete = 0`, [row.agent_id]
      );
      const sentAt = sentRows[0]?.last_sent_at;
      const deliveryNow = Date.now();
      if (sentAt != null && deliveryNow < Number(sentAt) + Number(currentAgent.telegram_alert_cooldown_seconds) * 1000) {
        await connection.execute("UPDATE notification_outbox SET next_attempt_at = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND is_delete = 0",
          [Number(sentAt) + Number(currentAgent.telegram_alert_cooldown_seconds) * 1000, deliveryNow, row.id]);
        return;
      }
      // Lock and recheck after queue selection so cancellation and competing workers cannot reuse a stale row.
      const [pendingRows] = await connection.execute<RowDataPacket[]>(
        `SELECT o.attempt_count, o.payload_json, o.event_type, i.status AS incident_status FROM notification_outbox o
         INNER JOIN incidents i ON i.id = o.incident_id
         WHERE o.id = ? AND o.status = 'pending' AND o.is_delete = 0 AND i.is_delete = 0 AND o.next_attempt_at <= ? FOR UPDATE`, [row.id, deliveryNow]
      );
      if (!pendingRows[0]) return;
      if (pendingRows[0].event_type === "opened" && pendingRows[0].incident_status !== "open") {
        await connection.execute("UPDATE notification_outbox SET status = 'cancelled', updated_at = ? WHERE id = ?", [deliveryNow, row.id]);
        return;
      }
      const payload = typeof pendingRows[0].payload_json === "string" ? JSON.parse(pendingRows[0].payload_json) : pendingRows[0].payload_json;
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
         SET status = 'sent', sent_at = ?, updated_at = ?, last_error = NULL
         WHERE id = ?`,
        [completedAt, completedAt, row.id]
      );
    } else {
      const failedAt = Date.now();
      const attempts = Number(pendingRows[0].attempt_count) + 1;
      const failed = attempts >= 10;
      const nextAttempt = failedAt + Math.min(60 * 60 * 1000, 2 ** attempts * 1000);
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
    recurringTask("heartbeat-expiry", 5_000, logger, () => scanMissedHeartbeats(config)),
    recurringTask("telegram-outbox", 10_000, logger, () => deliverTelegram(config)),
    recurringTask("history-retention", RETENTION_INTERVAL_MS, logger, () => purgeExpiredHistory(config, logger))
  ];
  return () => timers.forEach((timer) => clearInterval(timer));
}
