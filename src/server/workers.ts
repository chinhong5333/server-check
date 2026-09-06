import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Logger } from "pino";
import type { AppConfig } from "./config.js";
import { getPool, withTransaction } from "./db.js";
import { decryptPlatformTelegramBotToken } from "./security/telegram-secrets.js";
import { heartbeatDeadline, isHeartbeatOverdue } from "./services/heartbeat-deadline.js";
import { sendTelegramMessage } from "./services/telegram.js";

interface StaleAgentRow extends RowDataPacket {
  id: string;
  public_id: string;
  project_id: string;
  server_name: string;
  project_name: string;
  last_heartbeat_at: string | null;
  created_at: string;
  heartbeat_interval_seconds: number;
  incident_id: string | null;
}

interface OutboxRow extends RowDataPacket {
  id: string;
  agent_id: string;
  payload_json: Record<string, unknown> | string;
  attempt_count: number;
  telegram_alert_cooldown_seconds: number;
  last_sent_at: string | null;
}

interface PlatformTelegramRow extends RowDataPacket {
  telegram_bot_token_encrypted: string | null;
  telegram_chat_id: string | null;
}

async function scanMissedHeartbeats(config: AppConfig): Promise<void> {
  const now = Date.now();
  const [rows] = await getPool(config).query<StaleAgentRow[]>(
    `SELECT a.id, a.public_id, a.project_id, a.server_name, a.last_heartbeat_at, a.created_at,
            p.name AS project_name, a.heartbeat_interval_seconds,
            i.id AS incident_id
     FROM agents a
     INNER JOIN projects p ON p.id = a.project_id
     LEFT JOIN incidents i ON i.agent_id = a.id AND i.incident_type = 'heartbeat_missed'
       AND i.status = 'open' AND i.is_delete = 0
     WHERE a.is_delete = 0 AND p.is_delete = 0`
  );

  for (const agent of rows) {
    const baseline = agent.last_heartbeat_at ? Number(agent.last_heartbeat_at) : Number(agent.created_at);
    const intervalSeconds = Number(agent.heartbeat_interval_seconds);
    const dueAt = heartbeatDeadline(baseline, intervalSeconds);
    if (!isHeartbeatOverdue(now, baseline, intervalSeconds)) continue;

    await withTransaction(config, async (connection) => {
      await connection.execute(
        `UPDATE agents
         SET status = 'critical', probable_cause = 'Heartbeat overdue', updated_at = ?
         WHERE id = ?`,
        [now, agent.id]
      );
      if (agent.incident_id) return;

      const incidentPublicId = randomUUID();
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO incidents
          (public_id, project_id, agent_id, incident_type, severity, status,
           probable_cause, details_json, opened_at, resolved_at, last_notification_at,
           created_at, updated_at, is_delete)
         VALUES (?, ?, ?, 'heartbeat_missed', 'critical', 'open', 'Heartbeat overdue', ?, ?, NULL, NULL, ?, ?, 0)`,
        [
          incidentPublicId,
          agent.project_id,
          agent.id,
          JSON.stringify({ last_heartbeat_at: agent.last_heartbeat_at ? baseline : null, due_at: dueAt }),
          now,
          now,
          now
        ]
      );
      await connection.execute(
        `INSERT INTO notification_outbox
          (project_id, incident_id, channel, event_type, destination, payload_json,
           status, attempt_count, next_attempt_at, sent_at, last_error,
           created_at, updated_at, is_delete)
         VALUES (?, ?, 'telegram', 'opened', NULL, ?, 'pending', 0, ?, NULL, NULL, ?, ?, 0)`,
        [
          agent.project_id,
          result.insertId,
          JSON.stringify({
            incident_id: incidentPublicId,
            project_name: agent.project_name,
            agent_id: agent.public_id,
            server_name: agent.server_name,
            probable_cause: "Heartbeat overdue",
            severity: "critical",
            opened_at: now,
            details: { last_heartbeat_at: agent.last_heartbeat_at ? baseline : null }
          }),
          now,
          now,
          now
        ]
      );
    });
  }
}

async function purgeExpiredHistory(config: AppConfig): Promise<void> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  await getPool(config).execute(
    "DELETE FROM heartbeat_events WHERE received_at < ? ORDER BY id LIMIT 10000",
    [cutoff]
  );
  await getPool(config).execute(
    "DELETE FROM metric_samples WHERE received_at < ? ORDER BY id LIMIT 5000",
    [cutoff]
  );
}

function telegramText(payload: Record<string, unknown>): string {
  const severity = String(payload.severity ?? "recovery").toUpperCase();
  const serverName = String(payload.server_name ?? "Unknown server");
  const cause = String(payload.probable_cause ?? "Monitoring state changed");
  const projectName = String(payload.project_name ?? "Unknown project");
  return `[${severity}] ${serverName}\nProject: ${projectName}\nProbable cause: ${cause}`.slice(0, 4096);
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
  const botToken = decryptPlatformTelegramBotToken(
    config.jwt.secret,
    settings.telegram_bot_token_encrypted
  );

  const [rows] = await getPool(config).execute<OutboxRow[]>(
    `SELECT outbox.id, incident.agent_id, outbox.payload_json, outbox.attempt_count,
            agent.telegram_alert_cooldown_seconds,
            (SELECT MAX(previous.sent_at)
             FROM notification_outbox previous
             INNER JOIN incidents previous_incident ON previous_incident.id = previous.incident_id
             WHERE previous_incident.agent_id = incident.agent_id
               AND previous.channel = 'telegram' AND previous.status = 'sent'
               AND previous.is_delete = 0) AS last_sent_at
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

  const lastSentByAgent = new Map<string, number>();
  for (const row of rows) {
    const recordedLastSent = row.last_sent_at === null ? null : Number(row.last_sent_at);
    const lastSentAt = lastSentByAgent.get(row.agent_id) ?? recordedLastSent;
    const cooldownMilliseconds = Number(row.telegram_alert_cooldown_seconds) * 1000;
    if (lastSentAt !== null && now < lastSentAt + cooldownMilliseconds) {
      const nextAttemptAt = lastSentAt + cooldownMilliseconds;
      await getPool(config).execute(
        `UPDATE notification_outbox
         SET next_attempt_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending' AND is_delete = 0`,
        [nextAttemptAt, now, row.id]
      );
      continue;
    }
    const payload =
      typeof row.payload_json === "string"
        ? (JSON.parse(row.payload_json) as Record<string, unknown>)
        : row.payload_json;
    try {
      await sendTelegramMessage({
        botToken,
        chatId: settings.telegram_chat_id,
        text: telegramText(payload)
      });
      await getPool(config).execute(
        `UPDATE notification_outbox
         SET status = 'sent', sent_at = ?, updated_at = ?, last_error = NULL
         WHERE id = ?`,
        [now, now, row.id]
      );
      lastSentByAgent.set(row.agent_id, now);
    } catch (error) {
      const attempts = Number(row.attempt_count) + 1;
      const failed = attempts >= 10;
      const nextAttempt = now + Math.min(60 * 60 * 1000, 2 ** attempts * 1000);
      await getPool(config).execute(
        `UPDATE notification_outbox
         SET status = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
        [
          failed ? "failed" : "pending",
          attempts,
          nextAttempt,
          (error instanceof Error ? error.message : String(error)).slice(0, 500),
          now,
          row.id
        ]
      );
    }
  }
}

function recurringTask(
  name: string,
  intervalMs: number,
  logger: Logger,
  task: () => Promise<void>
): NodeJS.Timeout {
  const run = async () => {
    try {
      await task();
    } catch (error) {
      logger.error({ err: error, worker: name }, "Background worker failed");
    }
  };
  void run();
  return setInterval(run, intervalMs);
}

export function startWorkers(config: AppConfig, logger: Logger): () => void {
  const timers = [
    recurringTask("heartbeat-expiry", 5_000, logger, () => scanMissedHeartbeats(config)),
    recurringTask("telegram-outbox", 10_000, logger, () => deliverTelegram(config)),
    recurringTask("history-retention", 60 * 60 * 1000, logger, () => purgeExpiredHistory(config))
  ];
  return () => timers.forEach((timer) => clearInterval(timer));
}
