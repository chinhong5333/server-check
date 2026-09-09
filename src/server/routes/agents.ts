import { Router, type Request } from "express";
import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { agentHealthSnapshotSchema } from "../../shared/contracts.js";
import { readAgentChecks } from "../services/check-configuration.js";
import type {
  AgentIncidentLog,
  AgentSummary,
  TelegramDeliverySummary
} from "../../shared/contracts.js";
import type { AppConfig } from "../config.js";
import { getPool, withTransaction, type ResultSetHeader } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { lockAgentAlerts } from "../services/alert-queue.js";

const historyQuerySchema = z
  .object({
    from: z.coerce.number().int().nonnegative(),
    to: z.coerce.number().int().positive(),
    bucket_seconds: z.coerce.number().int().refine((value) => [60, 300, 1800, 3600].includes(value))
  })
  .strict();

interface AgentRow extends RowDataPacket {
  id: string;
  public_id: string;
  server_name: string;
  health_api_url: string | null;
  check_configuration_json: unknown;
  last_service_checks_json: unknown;
  project_public_id: string;
  status: AgentSummary["status"];
  probable_cause: string | null;
  last_heartbeat_at: string | null;
  last_metrics_at: string | null;
  agent_version: string | null;
  heartbeat_interval_seconds: number;
  latest_load_5: string | null;
}

interface MetricBucketRow extends RowDataPacket {
  bucket_at: string;
  ram_available_percent: string | null;
  load_5_per_core: string | null;
  load_5: string | null;
  health_latency_ms: string | null;
  healthy_ratio: string | null;
}

interface FilesystemBucketRow extends RowDataPacket {
  bucket_at: string;
  disk_available_percent: string | null;
}

interface IncidentRow extends RowDataPacket {
  public_id: string;
  incident_type: string;
  status: "open" | "resolved";
  opened_at: string;
  resolved_at: string | null;
  probable_cause: string;
  severity: "warning" | "critical";
  details_json: unknown;
  last_notification_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TelegramDeliveryRow extends RowDataPacket {
  id: string;
  event_type: "opened" | "resolved";
  incident_type: string;
  probable_cause: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  attempt_count: number;
  next_attempt_at: string;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
}

const emptyQuerySchema = z.object({}).strict();

function parseIncidentDetails(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function createAgentsRouter(config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(config));

  /**
   * GET /api/v1/agents/:agent_id/history
   * Returns current agent status and downsampled monitoring history over a maximum seven-day range.
   * History points include raw load_5 bucket averages; latest_load_5 is the raw five-minute
   * load from the current heartbeat, independent of the history range, or null when unavailable.
   * The existing load_5_per_core field retains its normalized meaning.
   * @param {object} request.body No request body is accepted by this read-only endpoint.
   * @param {Request<{agent_id: string}, {}, {}, {from: string, to: string, bucket_seconds: string}>} request Authenticated history request.
   * @param {string} request.params.agent_id Public identifier of the active agent.
   * @param {string} request.query.from Inclusive Unix timestamp in milliseconds for the history range start.
   * @param {string} request.query.to Inclusive Unix timestamp in milliseconds for the history range end.
   * @param {string} request.query.bucket_seconds Aggregation bucket; accepted values are 60, 300, 1800, and 3600.
   * @param {import("express").Response} response Current status summary and aligned metric-history points for the selected agent.
   * @returns {Promise<void>} Returns agent.checks selections and nullable agent.service_health (apache/nginx service_name/status and middleware_api probe diagnostics) with the latest valid report timestamp; resolves after aggregation.
   */
  router.get(
    "/:agent_id/history",
    asyncHandler(async (request: Request<{ agent_id: string }>, response) => {
      const query = historyQuerySchema.parse(request.query);
      if (query.to <= query.from) {
        throw new AppError(422, "invalid_time_range", "query.to must be greater than query.from.");
      }
      if (query.to - query.from > 7 * 24 * 60 * 60 * 1000) {
        throw new AppError(422, "time_range_too_large", "History queries are limited to seven days.");
      }

      const [agentRows] = await getPool(config).execute<AgentRow[]>(
        `SELECT a.id, a.public_id, a.server_name, a.health_api_url, a.check_configuration_json,
                a.last_service_checks_json, a.status, a.probable_cause,
                a.last_heartbeat_at, a.last_metrics_at, a.agent_version,
                a.heartbeat_interval_seconds, p.public_id AS project_public_id,
                (SELECT m.load_5 FROM metric_samples m
                 WHERE m.agent_id = a.id AND m.received_at = a.last_heartbeat_at AND m.is_delete = 0
                 ORDER BY m.id DESC LIMIT 1) AS latest_load_5
         FROM agents a
         INNER JOIN projects p ON p.id = a.project_id
         WHERE a.public_id = ? AND a.is_delete = 0 AND p.is_delete = 0
         LIMIT 1`,
        [request.params.agent_id]
      );
      const agent = agentRows[0];
      if (!agent) throw new AppError(404, "agent_not_found", "The selected agent does not exist.");

      const bucketMilliseconds = query.bucket_seconds * 1000;
      const [metricRows] = await getPool(config).execute<MetricBucketRow[]>(
        `SELECT
           FLOOR(received_at / ?) * ? AS bucket_at,
           AVG(CASE WHEN memory_total_bytes > 0
                    THEN memory_available_bytes * 100.0 / memory_total_bytes END) AS ram_available_percent,
           AVG(CASE WHEN cpu_count > 0 THEN load_5 / cpu_count END) AS load_5_per_core,
           AVG(load_5) AS load_5,
           AVG(health_latency_ms) AS health_latency_ms,
           AVG(CASE WHEN health_outcome = 'healthy' THEN 1 WHEN health_outcome = 'unhealthy' THEN 0 END) AS healthy_ratio
         FROM metric_samples
         WHERE agent_id = ? AND received_at BETWEEN ? AND ? AND is_delete = 0
         GROUP BY bucket_at
         ORDER BY bucket_at ASC`,
        [bucketMilliseconds, bucketMilliseconds, agent.id, String(query.from), String(query.to)]
      );
      const [filesystemRows] = await getPool(config).execute<FilesystemBucketRow[]>(
        `SELECT
           FLOOR(observed_at / ?) * ? AS bucket_at,
           MIN(CASE WHEN total_bytes > 0 THEN available_bytes * 100.0 / total_bytes END)
             AS disk_available_percent
         FROM filesystem_samples
         WHERE agent_id = ? AND observed_at BETWEEN ? AND ? AND is_delete = 0
         GROUP BY bucket_at
         ORDER BY bucket_at ASC`,
        [bucketMilliseconds, bucketMilliseconds, agent.id, String(query.from), String(query.to)]
      );

      const diskByBucket = new Map(
        filesystemRows.map((row) => [Number(row.bucket_at), Number(row.disk_available_percent)])
      );
      response.status(200).json({
        agent: {
          id: agent.public_id,
          project_id: agent.project_public_id,
          server_name: agent.server_name,
          health_api_url: agent.health_api_url,
          checks: readAgentChecks(agent.check_configuration_json),
          service_health: agent.last_service_checks_json == null ? null : agentHealthSnapshotSchema.parse(
            typeof agent.last_service_checks_json === "string" ? JSON.parse(agent.last_service_checks_json) : agent.last_service_checks_json
          ),
          status: agent.status,
          probable_cause: agent.probable_cause,
          last_heartbeat_at: agent.last_heartbeat_at === null ? null : Number(agent.last_heartbeat_at),
          last_metrics_at: agent.last_metrics_at === null ? null : Number(agent.last_metrics_at),
          agent_version: agent.agent_version,
          heartbeat_interval_seconds: Number(agent.heartbeat_interval_seconds)
        },
        from: query.from,
        to: query.to,
        bucket_seconds: query.bucket_seconds,
        latest_load_5: agent.latest_load_5 == null ? null : Number(agent.latest_load_5),
        points: metricRows.map((row) => ({
          at: Number(row.bucket_at),
          ram_available_percent:
            row.ram_available_percent === null ? null : Number(row.ram_available_percent),
          disk_available_percent: diskByBucket.get(Number(row.bucket_at)) ?? null,
          load_5_per_core: row.load_5_per_core === null ? null : Number(row.load_5_per_core),
          load_5: row.load_5 == null ? null : Number(row.load_5),
          health_latency_ms: row.health_latency_ms === null ? null : Number(row.health_latency_ms),
          health_success_percent: row.healthy_ratio === null ? null : Number(row.healthy_ratio) * 100
        }))
      });
    })
  );

  /**
   * GET /api/v1/agents/:agent_id/incidents
   * Lists recent incidents for one active agent.
   * @param {Request<{agent_id: string}, {}, {}, {}>} request Authenticated request with canonical params.agent_id; body and query must be empty.
   * @param {string} request.params.agent_id Public identifier of the active agent.
   * @param {import("express").Response<AgentIncidentLog[]>} response Complete normalized agent incident logs ordered newest first.
   * @returns {Promise<void>} Resolves after active-agent and incident lookup.
   */
  router.get(
    "/:agent_id/incidents",
    asyncHandler(async (request: Request<{ agent_id: string }>, response) => {
      emptyQuerySchema.parse(request.query);
      const [agentRows] = await getPool(config).execute<AgentRow[]>(
        `SELECT a.id, a.public_id, a.server_name, p.public_id AS project_public_id
         FROM agents a
         INNER JOIN projects p ON p.id = a.project_id
         WHERE a.public_id = ? AND a.is_delete = 0 AND p.is_delete = 0
         LIMIT 1`,
        [request.params.agent_id]
      );
      const agent = agentRows[0];
      if (!agent) throw new AppError(404, "agent_not_found", "The selected agent does not exist.");

      const [rows] = await getPool(config).execute<IncidentRow[]>(
        `SELECT public_id, incident_type, severity, status, probable_cause, details_json,
                opened_at, resolved_at, last_notification_at, created_at, updated_at
         FROM incidents
         WHERE agent_id = ? AND is_delete = 0
         ORDER BY opened_at DESC
         LIMIT 200`,
        [agent.id]
      );
      const incidents: AgentIncidentLog[] = rows.map((row) => ({
        id: row.public_id,
        agent_id: agent.public_id,
        server_name: agent.server_name,
        incident_type: row.incident_type,
        status: row.status,
        opened_at: Number(row.opened_at),
        resolved_at: row.resolved_at === null ? null : Number(row.resolved_at),
        probable_cause: row.probable_cause,
        severity: row.severity,
        details: parseIncidentDetails(row.details_json),
        last_notification_at: row.last_notification_at === null ? null : Number(row.last_notification_at),
        created_at: Number(row.created_at),
        updated_at: Number(row.updated_at)
      }));
      response.status(200).json(incidents);
    })
  );

  /**
   * GET /api/v1/agents/:agent_id/telegram-deliveries
   * Lists recent Telegram delivery attempts for one active agent.
   * @param {Request<{agent_id: string}, {}, {}, {}>} request Authenticated request with canonical params.agent_id; body and query must be empty.
   * @param {string} request.params.agent_id Public identifier of the active agent.
   * @param {import("express").Response<TelegramDeliverySummary[]>} response Telegram delivery records ordered newest first.
   * @returns {Promise<void>} Resolves after active-agent and delivery-log lookup.
   */
  router.get(
    "/:agent_id/telegram-deliveries",
    asyncHandler(async (request: Request<{ agent_id: string }>, response) => {
      emptyQuerySchema.parse(request.query);
      const [agentRows] = await getPool(config).execute<AgentRow[]>(
        `SELECT a.id, a.public_id, a.server_name, p.public_id AS project_public_id
         FROM agents a
         INNER JOIN projects p ON p.id = a.project_id
         WHERE a.public_id = ? AND a.is_delete = 0 AND p.is_delete = 0
         LIMIT 1`,
        [request.params.agent_id]
      );
      const agent = agentRows[0];
      if (!agent) throw new AppError(404, "agent_not_found", "The selected agent does not exist.");

      const [rows] = await getPool(config).execute<TelegramDeliveryRow[]>(
        `SELECT outbox.id, outbox.event_type, incident.incident_type,
                incident.probable_cause, outbox.status, outbox.attempt_count,
                outbox.next_attempt_at, outbox.sent_at, outbox.last_error,
                outbox.created_at
         FROM notification_outbox outbox
         INNER JOIN incidents incident ON incident.id = outbox.incident_id
         WHERE incident.agent_id = ? AND outbox.channel = 'telegram'
           AND outbox.is_delete = 0 AND incident.is_delete = 0
         ORDER BY outbox.created_at DESC
         LIMIT 200`,
        [agent.id]
      );
      const deliveries: TelegramDeliverySummary[] = rows.map((row) => ({
        id: String(row.id),
        event_type: row.event_type,
        incident_type: row.incident_type,
        probable_cause: row.probable_cause,
        status: row.status,
        attempt_count: Number(row.attempt_count),
        queued_at: Number(row.created_at),
        next_attempt_at: Number(row.next_attempt_at),
        sent_at: row.sent_at === null ? null : Number(row.sent_at),
        last_error: row.last_error
      }));
      response.status(200).json(deliveries);
    })
  );

  /**
   * POST /api/v1/agents/:agent_id/telegram-deliveries/cancel-pending
   * Cancels pending Telegram deliveries for exactly one active agent and retains their log records.
   * @param {Request} request Admin and CSRF authenticated request; query must be empty.
   * @param {string} request.params.agent_id Active agent public UUID.
   * @param {true} request.body.confirm Must be explicitly true after the UI's second confirmation.
   * @param {import("express").Response} response 200 with cancelled_count; in-flight sends may complete first.
   * @returns {Promise<void>} Atomically cancels queued rows and records an audit event; future alerts are unaffected.
   */
  router.post("/:agent_id/telegram-deliveries/cancel-pending", requireRole("admin"), requireCsrf,
    asyncHandler(async (request, response) => {
      z.object({ confirm: z.literal(true) }).strict().parse(request.body);
      emptyQuerySchema.parse(request.query);
      const cancelledCount = await withTransaction(config, async (connection) => {
        const [agents] = await connection.execute<RowDataPacket[]>(
          `SELECT a.id, a.project_id FROM agents a INNER JOIN projects p ON p.id = a.project_id
           WHERE a.public_id = ? AND a.is_delete = 0 AND p.is_delete = 0 LIMIT 1`, [request.params.agent_id]
        );
        if (!agents[0]) throw new AppError(404, "agent_not_found", "The selected agent does not exist.");
        if (!await lockAgentAlerts(connection, String(agents[0].id))) throw new AppError(404, "agent_not_found", "The selected agent does not exist.");
        const now = Date.now();
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE notification_outbox o INNER JOIN incidents i ON i.id = o.incident_id
           SET o.status = 'cancelled', o.last_error = NULL, o.updated_at = ?
           WHERE i.agent_id = ? AND o.channel = 'telegram' AND o.status = 'pending'
             AND o.is_delete = 0 AND o.created_at <= ?`, [now, agents[0].id, now]
        );
        await connection.execute(
          `INSERT INTO audit_events (user_id, project_id, action, entity_type, entity_id, metadata_json, created_at, updated_at, is_delete)
           VALUES (?, ?, 'telegram.cancel_pending', 'agent', ?, ?, ?, ?, 0)`,
          [request.auth!.userInternalId, agents[0].project_id, request.params.agent_id,
            JSON.stringify({ cancelled_count: result.affectedRows }), now, now]
        );
        return result.affectedRows;
      });
      response.json({ cancelled_count: cancelledCount });
    }));
  return router;
}
