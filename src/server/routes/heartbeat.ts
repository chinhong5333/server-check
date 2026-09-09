import { Router, raw, type Request } from "express";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { telemetryPayloadSchema } from "../../shared/contracts.js";
import type { AppConfig } from "../config.js";
import { getPool, withTransaction } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { safeEqualHex, sha256 } from "../security/crypto.js";
import { evaluateTelemetryIncidents, recordAgentCondition, resolveHeartbeatIncident } from "../services/incidents.js";
import { lockAgentAlerts } from "../services/alert-queue.js";
import { matchesConfiguredChecks, readAgentChecks } from "../services/check-configuration.js";

interface AgentPolicyRow extends RowDataPacket {
  id: string;
  public_id: string;
  project_id: string;
  server_name: string;
  credential_hash: string;
  project_name: string;
  ram_available_threshold_percent: string;
  disk_available_threshold_percent: string;
  load_5_per_core_threshold: string;
  check_configuration_json: unknown;
}

function bearerCredential(request: Request): string {
  const authorization = request.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new AppError(401, "agent_authentication_failed", "Agent authentication failed.");
  }
  return authorization.slice("Bearer ".length).trim();
}

function agentPublicIdFromCredential(credential: string): string {
  const match = /^ag_([0-9a-f-]{36})\.[A-Za-z0-9_-]+$/i.exec(credential);
  if (!match?.[1]) {
    throw new AppError(401, "agent_authentication_failed", "Agent authentication failed.");
  }
  return match[1];
}

async function authenticateAgent(config: AppConfig, request: Request): Promise<AgentPolicyRow> {
  const credential = bearerCredential(request);
  const agentPublicId = agentPublicIdFromCredential(credential);
  const [rows] = await getPool(config).execute<AgentPolicyRow[]>(
    `SELECT a.id, a.public_id, a.project_id, a.server_name, a.credential_hash,
            p.name AS project_name, a.ram_available_threshold_percent,
            a.disk_available_threshold_percent, a.load_5_per_core_threshold, a.check_configuration_json
     FROM agents a
     INNER JOIN projects p ON p.id = a.project_id
     WHERE a.public_id = ? AND a.is_delete = 0 AND p.is_delete = 0
     LIMIT 1`,
    [agentPublicId]
  );
  const agent = rows[0];
  if (!agent || !safeEqualHex(sha256(credential), agent.credential_hash)) {
    throw new AppError(401, "agent_authentication_failed", "Agent authentication failed.");
  }
  return agent;
}

/**
 * Runs heartbeat collection under the same agent lock used by queue delivery and cancellation.
 * @param {AppConfig} config Database configuration.
 * @param {AgentPolicyRow} agent Authenticated agent.
 * @param {(connection: PoolConnection) => Promise<T>} operation Atomic heartbeat operation.
 * @returns {Promise<T>} The operation result; rejects if the agent was removed.
 */
async function withAgentTransaction<T>(config: AppConfig, agent: AgentPolicyRow, operation: (connection: PoolConnection) => Promise<T>): Promise<T> {
  return withTransaction(config, async (connection) => {
    if (!await lockAgentAlerts(connection, agent.id)) throw new AppError(404, "agent_not_found", "The agent is no longer active.");
    return operation(connection);
  });
}

export function createHeartbeatRouter(config: AppConfig): Router {
  const router = Router();

  /**
   * POST /api/v1/agent/heartbeats
   * Accepts an authenticated agent heartbeat with an optional canonical telemetry payload.
   * @param {Request<{}, {}, Buffer>} request Agent request authenticated by Authorization Bearer credential; body may be empty or JSON telemetry.
   * @param {object} request.body.service_checks Apache and optional legacy-compatible Nginx service results; each contains service_name and status (active, inactive, unknown, disabled).
   * @param {object} request.body.health_probe Middleware API result; disabled outcomes must have null HTTP, latency, and error fields. Configured enabled states must match the payload.
   * @param {import("express").Response} response Heartbeat and telemetry acceptance state.
   * @returns {Promise<void>} Resolves after heartbeat persistence and optional incident evaluation.
   */
  router.post(
    "/",
    raw({ type: () => true, limit: "128kb" }),
    asyncHandler(async (request, response) => {
      const agent = await authenticateAgent(config, request);
      const identity = { agentInternalId: agent.id, agentPublicId: agent.public_id, serverName: agent.server_name,
        projectInternalId: agent.project_id, projectName: agent.project_name };
      const now = Date.now();
      const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const hasPayload = rawBody.length > 0;

      if (!hasPayload) {
        await withAgentTransaction(config, agent, async (connection) => {
          await connection.execute(
            `INSERT INTO heartbeat_events
              (project_id, agent_id, received_at, has_payload, telemetry_valid,
               validation_error, created_at, updated_at, is_delete)
             VALUES (?, ?, ?, 0, 1, NULL, ?, ?, 0)`,
            [agent.project_id, agent.id, now, now, now]
          );
          await resolveHeartbeatIncident(
            connection,
            {
              agentInternalId: agent.id,
              agentPublicId: agent.public_id,
              serverName: agent.server_name,
              projectInternalId: agent.project_id,
              projectName: agent.project_name
            },
            now
          );
          await recordAgentCondition(connection, identity, { type: "telemetry_missing", severity: "warning",
            probableCause: "Agent online; telemetry not included", details: {} }, now);
          await connection.execute(
            `UPDATE agents
             SET last_heartbeat_at = ?, status = 'stale',
                 probable_cause = 'Agent online; telemetry not included', updated_at = ?
             WHERE id = ?`,
            [now, now, agent.id]
          );
        });
        response.status(202).json({ heartbeat_accepted: true, telemetry_accepted: false });
        return;
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(rawBody.toString("utf8"));
      } catch {
        decoded = null;
      }
      const parsed = telemetryPayloadSchema.safeParse(decoded);

      const checkMismatch = parsed.success && !matchesConfiguredChecks(readAgentChecks(agent.check_configuration_json), parsed.data);
      if (!parsed.success || checkMismatch) {
        const validationError = !parsed.success ? parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
          .join("; ")
          .slice(0, 500) : "Reported health checks do not match the latest generated script configuration.";
        await withAgentTransaction(config, agent, async (connection) => {
          await connection.execute(
            `INSERT INTO heartbeat_events
              (project_id, agent_id, received_at, has_payload, telemetry_valid,
               validation_error, created_at, updated_at, is_delete)
             VALUES (?, ?, ?, 1, 0, ?, ?, ?, 0)`,
            [agent.project_id, agent.id, now, validationError, now, now]
          );
          await resolveHeartbeatIncident(
            connection,
            {
              agentInternalId: agent.id,
              agentPublicId: agent.public_id,
              serverName: agent.server_name,
              projectInternalId: agent.project_id,
              projectName: agent.project_name
            },
            now
          );
          await recordAgentCondition(connection, identity, { type: "telemetry_invalid", severity: "warning",
            probableCause: "Agent online; telemetry payload invalid", details: { validation_error: validationError } }, now);
          await connection.execute(
            `UPDATE agents
             SET last_heartbeat_at = ?, last_validation_error = ?, status = 'stale',
                 probable_cause = 'Agent online; telemetry payload invalid', updated_at = ?
             WHERE id = ?`,
            [now, validationError, now, agent.id]
          );
        });
        response.status(422).json({
          heartbeat_accepted: true,
          telemetry_accepted: false,
          error: {
            code: "telemetry_validation_failed",
            message: "The heartbeat was accepted, but telemetry did not match the documented contract.",
            details: !parsed.success ? parsed.error.flatten() : { formErrors: [validationError] }
          }
        });
        return;
      }

      const payload = parsed.data;
      const result = await withAgentTransaction(config, agent, async (connection) => {
        await connection.execute(
          `INSERT INTO heartbeat_events
            (project_id, agent_id, received_at, has_payload, telemetry_valid,
             validation_error, created_at, updated_at, is_delete)
           VALUES (?, ?, ?, 1, 1, NULL, ?, ?, 0)`,
          [agent.project_id, agent.id, now, now, now]
        );
        await resolveHeartbeatIncident(
          connection,
          {
            agentInternalId: agent.id,
            agentPublicId: agent.public_id,
            serverName: agent.server_name,
            projectInternalId: agent.project_id,
            projectName: agent.project_name
          },
          now
        );

        const [existingRows] = await connection.execute<RowDataPacket[]>(
          `SELECT id FROM metric_samples
           WHERE agent_id = ? AND sequence_id = ? AND is_delete = 0
           LIMIT 1`,
          [agent.id, String(payload.sequence_id)]
        );
        if (existingRows[0]) {
          await connection.execute(
            "UPDATE agents SET last_heartbeat_at = ?, updated_at = ? WHERE id = ?",
            [now, now, agent.id]
          );
          return { duplicate: true };
        }

        const [metricResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO metric_samples
            (project_id, agent_id, sequence_id, observed_at, received_at, agent_version,
             cpu_count, load_1, load_5, load_15, memory_total_bytes,
             memory_available_bytes, swap_total_bytes, swap_free_bytes, uptime_seconds,
             health_checked_at, health_outcome, health_http_status_code, health_latency_ms,
             health_error_code, health_error_message, top_processes_json,
             created_at, updated_at, is_delete)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            agent.project_id,
            agent.id,
            String(payload.sequence_id),
            String(payload.observed_at),
            String(now),
            payload.agent_version,
            payload.metrics.cpu_count,
            payload.metrics.load_1,
            payload.metrics.load_5,
            payload.metrics.load_15,
            payload.metrics.memory_total_bytes === null
              ? null
              : String(payload.metrics.memory_total_bytes),
            payload.metrics.memory_available_bytes === null
              ? null
              : String(payload.metrics.memory_available_bytes),
            payload.metrics.swap_total_bytes === null
              ? null
              : String(payload.metrics.swap_total_bytes),
            payload.metrics.swap_free_bytes === null
              ? null
              : String(payload.metrics.swap_free_bytes),
            payload.metrics.uptime_seconds === null ? null : String(payload.metrics.uptime_seconds),
            String(payload.health_probe.checked_at),
            payload.health_probe.outcome,
            payload.health_probe.http_status_code,
            payload.health_probe.latency_ms,
            payload.health_probe.error_code,
            payload.health_probe.error_message,
            JSON.stringify(payload.top_processes),
            now,
            now
          ]
        );

        for (const filesystem of payload.filesystems) {
          await connection.execute(
            `INSERT INTO filesystem_samples
              (metric_sample_id, project_id, agent_id, observed_at, filesystem, mount_point,
               total_bytes, available_bytes, inode_used_percent,
               created_at, updated_at, is_delete)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [
              metricResult.insertId,
              agent.project_id,
              agent.id,
              String(payload.observed_at),
              filesystem.filesystem,
              filesystem.mount_point,
              String(filesystem.total_bytes),
              String(filesystem.available_bytes),
              filesystem.inode_used_percent,
              now,
              now
            ]
          );
        }

        for (const service of [payload.service_checks.apache, payload.service_checks.nginx ?? { service_name: "nginx", status: "disabled" }]) {
        await connection.execute(
          `INSERT INTO service_check_samples
            (metric_sample_id, project_id, agent_id, observed_at, service_name,
             service_status, created_at, updated_at, is_delete)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            metricResult.insertId,
            agent.project_id,
            agent.id,
            String(payload.observed_at),
            service.service_name,
            service.status,
            now,
            now
          ]
        );
        }

        const snapshot = await evaluateTelemetryIncidents(
          connection,
          {
            agentInternalId: agent.id,
            agentPublicId: agent.public_id,
            serverName: agent.server_name,
            projectInternalId: agent.project_id,
            projectName: agent.project_name,
            ramThreshold: Number(agent.ram_available_threshold_percent),
            diskThreshold: Number(agent.disk_available_threshold_percent),
            loadThreshold: Number(agent.load_5_per_core_threshold)
          },
          payload,
          now
        );

        await connection.execute(
          `UPDATE agents
           SET last_heartbeat_at = ?, last_metrics_at = ?, last_validation_error = NULL,
               agent_version = ?, status = ?, probable_cause = ?,
               last_ram_available_percent = ?, last_disk_available_percent = ?,
               last_load_5_per_core = ?, last_health_outcome = ?,
               last_health_http_status_code = ?, last_health_latency_ms = ?, last_service_checks_json = ?, updated_at = ?
           WHERE id = ?`,
          [
            now,
            now,
            payload.agent_version,
            snapshot.status,
            snapshot.probableCause,
            snapshot.ramAvailablePercent,
            snapshot.diskAvailablePercent,
            snapshot.load5PerCore,
            payload.health_probe.outcome,
            payload.health_probe.http_status_code,
            payload.health_probe.latency_ms,
            JSON.stringify({ apache: payload.service_checks.apache,
              nginx: payload.service_checks.nginx ?? { service_name: "nginx", status: "disabled" },
              middleware_api: payload.health_probe }),
            now,
            agent.id
          ]
        );

        return { duplicate: false };
      });

      response.status(202).json({
        heartbeat_accepted: true,
        telemetry_accepted: true,
        duplicate: result.duplicate
      });
    })
  );

  return router;
}
