import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sortProjectsBodySchema } from "../../shared/contracts.js";
import { Router, type Request } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  DEFAULT_HEALTH_REQUEST_TIMEOUT_SECONDS,
  createAgentInstallationBodySchema,
  createProjectBodySchema,
  deleteProjectBodySchema,
  generateAgentScriptBodySchema,
  updateAgentBodySchema,
  updateProjectBodySchema,
  type AgentInstallationResponse,
  type AgentSummary,
  type IncidentSummary,
  type ProjectSummary
} from "../../shared/contracts.js";
import type { AppConfig } from "../config.js";
import { getPool, withTransaction } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { readAgentChecks } from "../services/check-configuration.js";
import { createAgentCredential, sha256 } from "../security/crypto.js";
import {
  APACHE_AUTO_DETECT_LABEL,
  cronForInterval,
  generateAgentScript,
  normalizeHealthApiUrl
} from "../services/agent-script.js";

interface ProjectRow extends RowDataPacket {
  id: string;
  public_id: string;
  name: string;
  slug: string;
  healthy_agents: number;
  new_agents: number;
  warning_agents: number;
  critical_agents: number;
  stale_agents: number;
}

interface AgentRow extends RowDataPacket {
  id: string;
  public_id: string;
  server_name: string;
  health_api_url: string | null;
  check_configuration_json: unknown;
  status: AgentSummary["status"];
  probable_cause: string | null;
  last_heartbeat_at: string | null;
  last_metrics_at: string | null;
  agent_version: string | null;
  last_ram_available_percent: string | null;
  last_disk_available_percent: string | null;
  last_load_5_per_core: string | null;
  latest_load_5: string | null;
  last_health_outcome: "healthy" | "unhealthy" | null;
  last_health_http_status_code: number | null;
  last_health_latency_ms: number | null;
  ram_available_threshold_percent: string;
  disk_available_threshold_percent: string;
  load_5_per_core_threshold: string;
  heartbeat_interval_seconds: number;
  telegram_alert_cooldown_seconds: number;
}

interface AgentInternalRow extends RowDataPacket {
  id: string;
  public_id: string;
  server_name: string;
  health_api_url: string | null;
  check_configuration_json: unknown;
  ram_available_threshold_percent: string;
  disk_available_threshold_percent: string;
  load_5_per_core_threshold: string;
  heartbeat_interval_seconds: number;
  telegram_alert_cooldown_seconds: number;
}

interface IncidentRow extends RowDataPacket {
  public_id: string;
  agent_public_id: string;
  server_name: string;
  incident_type: string;
  status: "open" | "resolved";
  opened_at: string;
  resolved_at: string | null;
  probable_cause: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function numeric(value: string | number | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function findProject(config: AppConfig, projectPublicId: string): Promise<ProjectRow> {
  const [rows] = await getPool(config).execute<ProjectRow[]>(
    `SELECT id, public_id, name, slug,
            0 AS healthy_agents, 0 AS new_agents, 0 AS warning_agents,
            0 AS critical_agents, 0 AS stale_agents
     FROM projects
     WHERE public_id = ? AND is_delete = 0
     LIMIT 1`,
    [projectPublicId]
  );
  if (!rows[0]) throw new AppError(404, "project_not_found", "The selected project does not exist.");
  return rows[0];
}

async function findAgent(
  config: AppConfig,
  projectInternalId: string,
  agentPublicId: string
): Promise<AgentInternalRow> {
  const [rows] = await getPool(config).execute<AgentInternalRow[]>(
    `SELECT id, public_id, server_name, health_api_url,
            ram_available_threshold_percent, disk_available_threshold_percent,
            load_5_per_core_threshold, heartbeat_interval_seconds,
            telegram_alert_cooldown_seconds
     FROM agents
     WHERE project_id = ? AND public_id = ? AND is_delete = 0
     LIMIT 1`,
    [projectInternalId, agentPublicId]
  );
  if (!rows[0]) throw new AppError(404, "agent_not_found", "The selected agent does not exist in this project.");
  return rows[0];
}

export function createProjectsRouter(config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(config));
  router.use(requirePermission("view_projects"));

  /**
   * GET /api/v1/projects
   * Lists active monitoring projects with separate current counts for healthy, new, warning, critical, and stale agents.
   * Authorization: full admin or a sub-admin with view_projects.
   * @param {Request} request Authenticated request; request body and query must be empty.
   * @param {import("express").Response<ProjectSummary[]>} response Project summaries.
   * @returns {Promise<void>} Resolves after project aggregation.
   */
  router.get(
    "/",
    asyncHandler(async (_request, response) => {
      const [rows] = await getPool(config).query<ProjectRow[]>(
        `SELECT
           p.id, p.public_id, p.name, p.slug,
           SUM(CASE WHEN a.status = 'healthy' AND a.is_delete = 0 THEN 1 ELSE 0 END) AS healthy_agents,
           SUM(CASE WHEN a.status = 'new' AND a.is_delete = 0 THEN 1 ELSE 0 END) AS new_agents,
           SUM(CASE WHEN a.status = 'warning' AND a.is_delete = 0 THEN 1 ELSE 0 END) AS warning_agents,
           SUM(CASE WHEN a.status = 'critical' AND a.is_delete = 0 THEN 1 ELSE 0 END) AS critical_agents,
           SUM(CASE WHEN a.status = 'stale' AND a.is_delete = 0 THEN 1 ELSE 0 END) AS stale_agents
         FROM projects p
         LEFT JOIN agents a ON a.project_id = p.id
         WHERE p.is_delete = 0
         GROUP BY p.id
         ORDER BY p.sort_order ASC, p.name ASC, p.id ASC`
      );

      const projects: ProjectSummary[] = rows.map((row) => ({
        id: row.public_id,
        name: row.name,
        slug: row.slug,
        healthy_agents: Number(row.healthy_agents),
        new_agents: Number(row.new_agents),
        warning_agents: Number(row.warning_agents),
        critical_agents: Number(row.critical_agents),
        stale_agents: Number(row.stale_agents)
      }));
      response.status(200).json(projects);
    })
  );

  /**
   * PUT /api/v1/projects/order
   * Saves a global project order atomically, rejecting stale project snapshots.
   * Authorization: full admin or a sub-admin with view_projects and edit_project_settings.
   * @param {Request} request Admin request with empty query.
   * @param {string[]} request.body.ordered_ids Unique active project UUIDs in the desired order, maximum 2000.
   * @param {string[]} request.body.expected_ids All active project UUIDs in their originally displayed order.
   * @param {import("express").Response} response Empty 204 response; 409 if the project list changed.
   * @returns {Promise<void>} Persists order and audit together; requires admin role and CSRF.
   */
  router.put("/order", requirePermission("edit_project_settings"), requireCsrf, asyncHandler(async (request, response) => {
    const body = sortProjectsBodySchema.parse(request.body);
    z.object({}).strict().parse(request.query);
    await withTransaction(config, async (connection) => {
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id, public_id FROM projects WHERE is_delete = 0 ORDER BY sort_order, name, id FOR UPDATE"
      );
      if (rows.length !== body.expected_ids.length || rows.some((row, index) => row.public_id !== body.expected_ids[index])) {
        throw new AppError(409, "project_order_changed", "The project list changed. Cancel sorting, refresh, and try again.");
      }
      const now = Date.now();
      const byId = new Map(rows.map((row) => [row.public_id, row.id]));
      for (const [index, publicId] of body.ordered_ids.entries()) {
        await connection.execute("UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ?", [index + 1, now, byId.get(publicId)]);
      }
      await connection.execute(
        `INSERT INTO audit_events (user_id, action, entity_type, metadata_json, created_at, updated_at, is_delete)
         VALUES (?, 'project.reorder', 'project', ?, ?, ?, 0)`,
        [request.auth!.userInternalId, JSON.stringify({ ordered_ids: body.ordered_ids }), now, now]
      );
    });
    response.sendStatus(204);
  }));

  /**
   * POST /api/v1/projects
   * Creates one project. Monitoring policy is configured per agent.
   * Authorization: full admin or a sub-admin with view_projects and edit_project_settings.
   * @param {Request<{}, {}, import("zod").infer<typeof createProjectBodySchema>>} request Admin request with canonical body.name.
   * @param {string} request.body.name Project display name.
   * @param {import("express").Response<{id: string}>} response Created project identifier.
   * @returns {Promise<void>} Resolves after project and audit persistence.
   */
  router.post(
    "/",
    requirePermission("edit_project_settings"),
    requireCsrf,
    asyncHandler(async (request, response) => {
      const body = createProjectBodySchema.parse(request.body);
      const publicId = randomUUID();
      const slugBase = slugify(body.name) || "project";
      const slug = `${slugBase}-${publicId.slice(0, 8)}`;
      const now = Date.now();

      await withTransaction(config, async (connection) => {
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO projects
            (public_id, name, slug, ram_available_threshold_percent,
             disk_available_threshold_percent, load_5_per_core_threshold,
             heartbeat_interval_seconds, heartbeat_grace_seconds,
             created_at, updated_at, is_delete)
           VALUES (?, ?, ?, 15, 10, 1.5, 120, 0, ?, ?, 0)`,
          [publicId, body.name, slug, now, now]
        );
        await connection.execute(
          `INSERT INTO audit_events
            (user_id, project_id, action, entity_type, entity_id, metadata_json,
             created_at, updated_at, is_delete)
           VALUES (?, ?, 'project.create', 'project', ?, ?, ?, ?, 0)`,
          [request.auth!.userInternalId, result.insertId, publicId, JSON.stringify({ name: body.name }), now, now]
        );
      });

      response.status(201).json({ id: publicId });
    })
  );

  /**
   * PUT /api/v1/projects/:project_id
   * Replaces a project's display name while preserving its stable public identifier and slug.
   * Authorization: full admin or a sub-admin with view_projects and edit_project_settings.
   * @param {Request<{project_id: string}, {}, import("zod").infer<typeof updateProjectBodySchema>>} request Admin request with the canonical project identifier and body.name.
   * @param {string} request.params.project_id Public identifier of the project being renamed.
   * @param {string} request.body.name Replacement project display name.
   * @param {import("express").Response<void>} response Empty success response.
   * @returns {Promise<void>} Resolves after the project name and audit event are persisted.
   */
  router.put(
    "/:project_id",
    requirePermission("edit_project_settings"),
    requireCsrf,
    asyncHandler(async (request: Request<{ project_id: string }>, response) => {
      const body = updateProjectBodySchema.parse(request.body);
      const project = await findProject(config, request.params.project_id);
      const now = Date.now();

      await withTransaction(config, async (connection) => {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE projects
           SET name = ?, updated_at = ?
           WHERE id = ? AND is_delete = 0`,
          [body.name, now, project.id]
        );
        if (result.affectedRows !== 1) {
          throw new AppError(404, "project_not_found", "The selected project no longer exists.");
        }

        await connection.execute(
          `INSERT INTO audit_events
            (user_id, project_id, action, entity_type, entity_id, metadata_json,
             created_at, updated_at, is_delete)
           VALUES (?, ?, 'project.update', 'project', ?, ?, ?, ?, 0)`,
          [
            request.auth!.userInternalId,
            project.id,
            project.public_id,
            JSON.stringify({ previous_name: project.name, name: body.name }),
            now,
            now
          ]
        );
      });

      response.status(204).send();
    })
  );

  /**
   * DELETE /api/v1/projects/:project_id
   * Soft-removes a project, revokes and soft-removes its agents, resolves open incidents, and cancels pending notifications while retaining history.
   * Authorization: full admin or a sub-admin with view_projects and delete_projects.
   * @param {Request<{project_id: string}, {}, import("zod").infer<typeof deleteProjectBodySchema>>} request Admin request with the canonical project identifier and confirmation body; query must be empty.
   * @param {string} request.params.project_id Public identifier of the project being removed.
   * @param {string} request.body.confirmation_name Exact current project name required for destructive confirmation.
   * @param {import("express").Response<void>} response Empty success response.
   * @returns {Promise<void>} Resolves after project removal, credential revocation, incident closure, pending-notification cancellation, and audit persistence.
   */
  router.delete(
    "/:project_id",
    requirePermission("delete_projects"),
    requireCsrf,
    asyncHandler(async (request: Request<{ project_id: string }>, response) => {
      const body = deleteProjectBodySchema.parse(request.body);
      const project = await findProject(config, request.params.project_id);
      if (body.confirmation_name !== project.name) {
        throw new AppError(
          400,
          "project_confirmation_mismatch",
          "confirmation_name must exactly match the current project name."
        );
      }

      const now = Date.now();
      const credentialRevocationNonce = randomUUID();

      await withTransaction(config, async (connection) => {
        const [projectResult] = await connection.execute<ResultSetHeader>(
          `UPDATE projects
           SET is_delete = 1, updated_at = ?
           WHERE id = ? AND is_delete = 0`,
          [now, project.id]
        );
        if (projectResult.affectedRows !== 1) {
          throw new AppError(404, "project_not_found", "The selected project no longer exists.");
        }

        const [agentResult] = await connection.execute<ResultSetHeader>(
          `UPDATE agents
           SET credential_hash = SHA2(CONCAT('revoked:', public_id, ':', ?), 256),
               credential_hint = 'revoked', status = 'stale',
               probable_cause = 'Project removed', is_delete = 1, updated_at = ?
           WHERE project_id = ? AND is_delete = 0`,
          [credentialRevocationNonce, now, project.id]
        );
        await connection.execute(
          `UPDATE incidents
           SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?), updated_at = ?
           WHERE project_id = ? AND status = 'open' AND is_delete = 0`,
          [now, now, project.id]
        );
        await connection.execute(
          `UPDATE notification_outbox
           SET is_delete = 1, updated_at = ?
           WHERE project_id = ? AND status = 'pending' AND is_delete = 0`,
          [now, project.id]
        );
        await connection.execute(
          `INSERT INTO audit_events
            (user_id, project_id, action, entity_type, entity_id, metadata_json,
             created_at, updated_at, is_delete)
           VALUES (?, ?, 'project.delete', 'project', ?, ?, ?, ?, 0)`,
          [
            request.auth!.userInternalId,
            project.id,
            project.public_id,
            JSON.stringify({
              name: project.name,
              revoked_agent_count: agentResult.affectedRows,
              history_retained: true
            }),
            now,
            now
          ]
        );
      });

      response.status(204).send();
    })
  );

  /**
   * POST /api/v1/projects/:project_id/agents/:agent_id/credential-rotation
   * Explicitly rotates one agent credential and returns its one-time replacement script and crontab entry.
   * Authorization: full admin or a sub-admin with view_projects and rotate_agent_secrets.
   * @param {Request<{project_id: string, agent_id: string}, {}, import("zod").infer<typeof generateAgentScriptBodySchema>>} request Admin request with canonical project and agent identifiers and script health endpoint.
   * @param {string} request.params.project_id Public identifier of the owning project.
   * @param {string} request.params.agent_id Public identifier of the agent whose credential will be rotated.
   * @param {string|null} request.body.health_api_url Middleware HTTP(S) endpoint; required when checks.middleware_api is true, otherwise null.
   * @param {object} request.body.checks Check selections: apache, nginx, and middleware_api booleans. Omission preserves the pre-1.3 Apache/API defaults.
   * @param {boolean} request.body.checks.apache Enables the local Apache service check.
   * @param {boolean} request.body.checks.nginx Enables the local Nginx service/process check.
   * @param {boolean} request.body.checks.middleware_api Enables the HTTP 200 middleware probe.
   * @param {import("express").Response<AgentInstallationResponse>} response One-time replacement script and crontab response.
   * @returns {Promise<void>} Resolves after credential rotation, monitoring-state reset, incident closure, notification cancellation, and audit persistence.
   */
  router.post(
    "/:project_id/agents/:agent_id/credential-rotation",
    requirePermission("rotate_agent_secrets"),
    requireCsrf,
    asyncHandler(async (request: Request<{ project_id: string; agent_id: string }>, response) => {
      const body = generateAgentScriptBodySchema.parse(request.body);
      if (Object.keys(request.query).length > 0) {
        throw new AppError(400, "unexpected_rotation_query", "Credential rotation does not accept query parameters.");
      }
      const project = await findProject(config, request.params.project_id);
      const agent = await findAgent(config, project.id, request.params.agent_id);
      const healthApiUrl = body.health_api_url === null ? null : normalizeHealthApiUrl(body.health_api_url);
      const credential = createAgentCredential(agent.public_id);
      const now = Date.now();
      const scriptFilename = `server-check-${slugify(agent.server_name) || agent.public_id.slice(0, 8)}.sh`;
      const scriptPath = `/opt/server-check/${scriptFilename}`;
      const centralApiUrl = new URL("/api/v1/agent/heartbeats", config.publicBaseUrl).toString();

      await withTransaction(config, async (connection) => {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE agents
           SET credential_hash = ?, credential_hint = ?, health_api_url = ?,
               check_configuration_json = ?, last_service_checks_json = NULL,
               health_request_timeout_seconds = ?, status = 'new',
               probable_cause = 'Awaiting first heartbeat after script replacement',
               agent_version = NULL, last_heartbeat_at = NULL, last_metrics_at = NULL,
               last_validation_error = NULL, last_ram_available_percent = NULL,
               last_disk_available_percent = NULL, last_load_5_per_core = NULL,
               last_health_outcome = NULL, last_health_http_status_code = NULL,
               last_health_latency_ms = NULL, updated_at = ?
           WHERE id = ? AND project_id = ? AND is_delete = 0`,
          [
            credential.credentialHash,
            credential.credentialHint,
            healthApiUrl,
            JSON.stringify(body.checks),
            DEFAULT_HEALTH_REQUEST_TIMEOUT_SECONDS,
            now,
            agent.id,
            project.id
          ]
        );
        if (result.affectedRows !== 1) {
          throw new AppError(404, "agent_not_found", "The selected agent no longer exists in this project.");
        }
        await connection.execute(
          `UPDATE incidents
           SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?), updated_at = ?
           WHERE agent_id = ? AND status = 'open' AND is_delete = 0`,
          [now, now, agent.id]
        );
        await connection.execute(
          `UPDATE notification_outbox outbox
           INNER JOIN incidents incident ON incident.id = outbox.incident_id
           SET outbox.is_delete = 1, outbox.updated_at = ?
           WHERE incident.agent_id = ? AND outbox.status = 'pending' AND outbox.is_delete = 0`,
          [now, agent.id]
        );
        await connection.execute(
          `INSERT INTO audit_events
            (user_id, project_id, action, entity_type, entity_id, metadata_json,
             created_at, updated_at, is_delete)
           VALUES (?, ?, 'agent.credential.rotate', 'agent', ?, ?, ?, ?, 0)`,
          [
            request.auth!.userInternalId,
            project.id,
            agent.public_id,
            JSON.stringify({
              server_name: agent.server_name,
              previous_health_api_origin: agent.health_api_url ? new URL(agent.health_api_url).origin : null,
              health_api_origin: healthApiUrl ? new URL(healthApiUrl).origin : null,
              checks: body.checks,
              credential_rotated: true
            }),
            now,
            now
          ]
        );
      });

      const payload: AgentInstallationResponse = {
        agent_id: agent.public_id,
        script_filename: scriptFilename,
        script: generateAgentScript({
          agentId: agent.public_id,
          projectName: project.name,
          agentName: agent.server_name,
          credential: credential.credential,
          centralApiUrl,
          healthApiUrl,
          checks: body.checks,
          healthRequestTimeoutSeconds: DEFAULT_HEALTH_REQUEST_TIMEOUT_SECONDS
        }),
        crontab_entry: cronForInterval(agent.heartbeat_interval_seconds, scriptPath),
        credential_shown_once: true
      };
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(payload);
    })
  );

  /**
   * GET /api/v1/projects/:project_id/agents
   * Lists monitored agents and their latest diagnostic state for one project.
   * Includes latest_load_5 as raw five-minute load from the current heartbeat, or null
   * when unavailable. Existing load_5_per_core and alert thresholds remain normalized.
   * Authorization: full admin or a sub-admin with view_projects.
   * @param {Request<{project_id: string}>} request Authenticated request with canonical params.project_id.
   * @param {import("express").Response<AgentSummary[]>} response Agent summaries ordered by severity.
   * @param {object} response.body.checks Saved Apache, Nginx, and middleware_api selections for each agent.
   * @returns {Promise<void>} Resolves after agent lookup.
   */
  router.get(
    "/:project_id/agents",
    asyncHandler(async (request: Request<{ project_id: string }>, response) => {
      const project = await findProject(config, request.params.project_id);
      const [rows] = await getPool(config).execute<AgentRow[]>(
        `SELECT id, public_id, server_name, health_api_url, check_configuration_json, status, probable_cause,
                last_heartbeat_at, last_metrics_at, agent_version,
                last_ram_available_percent, last_disk_available_percent,
                last_load_5_per_core, last_health_outcome,
                last_health_http_status_code, last_health_latency_ms,
                ram_available_threshold_percent, disk_available_threshold_percent,
                load_5_per_core_threshold, heartbeat_interval_seconds,
                telegram_alert_cooldown_seconds,
                (SELECT m.load_5 FROM metric_samples m
                 WHERE m.agent_id = agents.id AND m.received_at = agents.last_heartbeat_at
                   AND m.is_delete = 0 ORDER BY m.id DESC LIMIT 1) AS latest_load_5
         FROM agents
         WHERE project_id = ? AND is_delete = 0
         ORDER BY FIELD(status, 'critical', 'warning', 'stale', 'new', 'healthy'), server_name ASC`,
        [project.id]
      );
      const agents: AgentSummary[] = rows.map((row) => ({
        id: row.public_id,
        server_name: row.server_name,
        health_api_url: row.health_api_url,
        checks: readAgentChecks(row.check_configuration_json),
        status: row.status,
        probable_cause: row.probable_cause,
        last_heartbeat_at: numeric(row.last_heartbeat_at),
        last_metrics_at: numeric(row.last_metrics_at),
        agent_version: row.agent_version,
        ram_available_percent: numeric(row.last_ram_available_percent),
        disk_available_percent: numeric(row.last_disk_available_percent),
        load_5_per_core: numeric(row.last_load_5_per_core),
        latest_load_5: row.latest_load_5 == null ? null : Number(row.latest_load_5),
        health_outcome: row.last_health_outcome,
        health_http_status_code: row.last_health_http_status_code,
        health_latency_ms: row.last_health_latency_ms,
        ram_available_threshold_percent: Number(row.ram_available_threshold_percent),
        disk_available_threshold_percent: Number(row.disk_available_threshold_percent),
        load_5_per_core_threshold: Number(row.load_5_per_core_threshold),
        heartbeat_interval_seconds: Number(row.heartbeat_interval_seconds),
        telegram_alert_cooldown_seconds: Number(row.telegram_alert_cooldown_seconds)
      }));
      response.status(200).json(agents);
    })
  );

  /**
   * PUT /api/v1/projects/:project_id/agents/:agent_id
   * Replaces an agent's editable configuration without changing its credential or current monitoring state.
   * Authorization: full admin or a sub-admin with view_projects and edit_agent_settings.
   * @param {Request<{project_id: string, agent_id: string}, {}, import("zod").infer<typeof updateAgentBodySchema>>} request Admin request with canonical agent update fields.
   * @param {string} request.params.project_id Public identifier of the owning project.
   * @param {string} request.params.agent_id Public identifier of the agent being updated.
   * @param {string} request.body.server_name Replacement internal server name.
   * @param {number} request.body.ram_available_threshold_percent Available-RAM incident threshold.
   * @param {number} request.body.disk_available_threshold_percent Available-storage incident threshold.
   * @param {number} request.body.load_5_per_core_threshold Five-minute load-per-core threshold.
   * @param {number} request.body.heartbeat_interval_seconds Maximum heartbeat interval expected by the central monitor.
   * @param {number} request.body.telegram_alert_cooldown_seconds Minimum gap between successful Telegram deliveries for this agent.
   * @param {import("express").Response<void>} response Empty success response.
   * @returns {Promise<void>} Resolves after configuration replacement and audit persistence.
   */
  router.put(
    "/:project_id/agents/:agent_id",
    requirePermission("edit_agent_settings"),
    requireCsrf,
    asyncHandler(async (request: Request<{ project_id: string; agent_id: string }>, response) => {
      const body = updateAgentBodySchema.parse(request.body);
      const project = await findProject(config, request.params.project_id);
      const agent = await findAgent(config, project.id, request.params.agent_id);
      const now = Date.now();

      await withTransaction(config, async (connection) => {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE agents
           SET server_name = ?, ram_available_threshold_percent = ?,
               disk_available_threshold_percent = ?,
               load_5_per_core_threshold = ?, heartbeat_interval_seconds = ?,
               telegram_alert_cooldown_seconds = ?,
               updated_at = ?
           WHERE id = ? AND project_id = ? AND is_delete = 0`,
          [
            body.server_name,
            body.ram_available_threshold_percent,
            body.disk_available_threshold_percent,
            body.load_5_per_core_threshold,
            body.heartbeat_interval_seconds,
            body.telegram_alert_cooldown_seconds,
            now,
            agent.id,
            project.id
          ]
        );
        if (result.affectedRows !== 1) {
          throw new AppError(404, "agent_not_found", "The selected agent no longer exists in this project.");
        }
        await connection.execute(
          `INSERT INTO audit_events
            (user_id, project_id, action, entity_type, entity_id, metadata_json,
             created_at, updated_at, is_delete)
           VALUES (?, ?, 'agent.update', 'agent', ?, ?, ?, ?, 0)`,
          [
            request.auth!.userInternalId,
            project.id,
            agent.public_id,
            JSON.stringify({
              previous_server_name: agent.server_name,
              server_name: body.server_name,
              ram_available_threshold_percent: body.ram_available_threshold_percent,
              disk_available_threshold_percent: body.disk_available_threshold_percent,
              load_5_per_core_threshold: body.load_5_per_core_threshold,
              heartbeat_interval_seconds: body.heartbeat_interval_seconds,
              telegram_alert_cooldown_seconds: body.telegram_alert_cooldown_seconds,
              credential_rotated: false
            }),
            now,
            now
          ]
        );
      });

      response.status(204).send();
    })
  );

  /**
   * DELETE /api/v1/projects/:project_id/agents/:agent_id
   * Soft-removes an agent, revokes its credential, resolves open incidents, and cancels pending notifications.
   * Authorization: full admin or a sub-admin with view_projects and delete_agents.
   * @param {Request<{project_id: string, agent_id: string}>} request Admin request with canonical project and agent identifiers; body and query must be empty.
   * @param {string} request.params.project_id Public identifier of the owning project.
   * @param {string} request.params.agent_id Public identifier of the agent being removed.
   * @param {import("express").Response<void>} response Empty success response.
   * @returns {Promise<void>} Resolves after credential revocation, soft deletion, incident closure, and audit persistence.
   */
  router.delete(
    "/:project_id/agents/:agent_id",
    requirePermission("delete_agents"),
    requireCsrf,
    asyncHandler(async (request: Request<{ project_id: string; agent_id: string }>, response) => {
      const project = await findProject(config, request.params.project_id);
      const agent = await findAgent(config, project.id, request.params.agent_id);
      const now = Date.now();
      const revokedCredentialHash = sha256(`revoked:${agent.public_id}:${randomUUID()}:${now}`);

      await withTransaction(config, async (connection) => {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE agents
           SET credential_hash = ?, credential_hint = 'revoked', status = 'stale',
               probable_cause = 'Agent removed', is_delete = 1, updated_at = ?
           WHERE id = ? AND project_id = ? AND is_delete = 0`,
          [revokedCredentialHash, now, agent.id, project.id]
        );
        if (result.affectedRows !== 1) {
          throw new AppError(404, "agent_not_found", "The selected agent no longer exists in this project.");
        }
        await connection.execute(
          `UPDATE incidents
           SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?), updated_at = ?
           WHERE agent_id = ? AND status = 'open' AND is_delete = 0`,
          [now, now, agent.id]
        );
        await connection.execute(
          `UPDATE notification_outbox outbox
           INNER JOIN incidents incident ON incident.id = outbox.incident_id
           SET outbox.is_delete = 1, outbox.updated_at = ?
           WHERE incident.agent_id = ? AND outbox.status = 'pending' AND outbox.is_delete = 0`,
          [now, agent.id]
        );
        await connection.execute(
          `INSERT INTO audit_events
            (user_id, project_id, action, entity_type, entity_id, metadata_json,
             created_at, updated_at, is_delete)
           VALUES (?, ?, 'agent.delete', 'agent', ?, ?, ?, ?, 0)`,
          [
            request.auth!.userInternalId,
            project.id,
            agent.public_id,
            JSON.stringify({ server_name: agent.server_name, credential_revoked: true }),
            now,
            now
          ]
        );
      });

      response.status(204).send();
    })
  );

  /**
   * GET /api/v1/projects/:project_id/incidents
   * Lists recent incidents for one project.
   * Authorization: full admin or a sub-admin with view_projects.
   * @param {Request<{project_id: string}>} request Authenticated request with canonical params.project_id.
   * @param {import("express").Response<IncidentSummary[]>} response Recent incident summaries.
   * @returns {Promise<void>} Resolves after incident lookup.
   */
  router.get(
    "/:project_id/incidents",
    asyncHandler(async (request: Request<{ project_id: string }>, response) => {
      const project = await findProject(config, request.params.project_id);
      const [rows] = await getPool(config).execute<IncidentRow[]>(
        `SELECT i.public_id, a.public_id AS agent_public_id, a.server_name,
                i.incident_type, i.status, i.opened_at, i.resolved_at, i.probable_cause
         FROM incidents i
         INNER JOIN agents a ON a.id = i.agent_id
         WHERE i.project_id = ? AND i.is_delete = 0
         ORDER BY i.opened_at DESC
         LIMIT 200`,
        [project.id]
      );
      const incidents: IncidentSummary[] = rows.map((row) => ({
        id: row.public_id,
        agent_id: row.agent_public_id,
        server_name: row.server_name,
        incident_type: row.incident_type,
        status: row.status,
        opened_at: Number(row.opened_at),
        resolved_at: row.resolved_at === null ? null : Number(row.resolved_at),
        probable_cause: row.probable_cause
      }));
      response.status(200).json(incidents);
    })
  );

  /**
   * POST /api/v1/projects/:project_id/agent-installations
   * Creates one registered agent and returns its one-time self-contained shell installation.
   * Authorization: full admin or a sub-admin with view_projects and edit_agent_settings.
   * @param {Request<{project_id: string}, {}, import("zod").infer<typeof createAgentInstallationBodySchema>>} request Admin request with canonical agent installation fields.
   * @param {string} request.params.project_id Public identifier of the owning project.
   * @param {string} request.body.server_name Internal display name for the monitored server.
   * @param {string|null} request.body.health_api_url Middleware HTTP(S) endpoint; required when checks.middleware_api is true, otherwise null.
   * @param {object} request.body.checks Check selections: apache, nginx, and middleware_api booleans. Omission preserves the pre-1.3 Apache/API defaults.
   * @param {boolean} request.body.checks.apache Enables the local Apache service check.
   * @param {boolean} request.body.checks.nginx Enables the local Nginx service/process check.
   * @param {boolean} request.body.checks.middleware_api Enables the HTTP 200 middleware probe.
   * @param {number} request.body.ram_available_threshold_percent Available-RAM incident threshold.
   * @param {number} request.body.disk_available_threshold_percent Available-storage incident threshold.
   * @param {number} request.body.load_5_per_core_threshold Five-minute load-per-core threshold.
   * @param {number} request.body.heartbeat_interval_seconds Maximum heartbeat interval and generated cron schedule.
   * @param {number} request.body.telegram_alert_cooldown_seconds Minimum gap between successful Telegram deliveries for this agent.
   * @param {import("express").Response<AgentInstallationResponse>} response One-time script and crontab response.
   * @returns {Promise<void>} Resolves after agent and audit persistence.
   */
  router.post(
    "/:project_id/agent-installations",
    requirePermission("edit_agent_settings"),
    requireCsrf,
    asyncHandler(async (request: Request<{ project_id: string }>, response) => {
      const body = createAgentInstallationBodySchema.parse(request.body);
      const project = await findProject(config, request.params.project_id);
      const healthApiUrl = body.health_api_url === null ? null : normalizeHealthApiUrl(body.health_api_url);
      const agentPublicId = randomUUID();
      const credential = createAgentCredential(agentPublicId);
      const now = Date.now();
      const scriptFilename = `server-check-${slugify(body.server_name) || agentPublicId.slice(0, 8)}.sh`;
      const scriptPath = `/opt/server-check/${scriptFilename}`;
      const centralApiUrl = new URL("/api/v1/agent/heartbeats", config.publicBaseUrl).toString();

      await withTransaction(config, async (connection) => {
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO agents
            (public_id, project_id, server_name, health_api_url, check_configuration_json,
             health_request_timeout_seconds, ram_available_threshold_percent,
             disk_available_threshold_percent, load_5_per_core_threshold,
             heartbeat_interval_seconds, telegram_alert_cooldown_seconds, apache_service_name,
             credential_hash, credential_hint, status, probable_cause,
             agent_version, last_heartbeat_at, last_metrics_at, last_validation_error,
             last_ram_available_percent, last_disk_available_percent,
             last_load_5_per_core, last_health_outcome,
             last_health_http_status_code, last_health_latency_ms,
             created_at, updated_at, is_delete)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'Awaiting first heartbeat',
                   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, 0)`,
          [
            agentPublicId,
            project.id,
            body.server_name,
            healthApiUrl,
            JSON.stringify(body.checks),
            DEFAULT_HEALTH_REQUEST_TIMEOUT_SECONDS,
            body.ram_available_threshold_percent,
            body.disk_available_threshold_percent,
            body.load_5_per_core_threshold,
            body.heartbeat_interval_seconds,
            body.telegram_alert_cooldown_seconds,
            APACHE_AUTO_DETECT_LABEL,
            credential.credentialHash,
            credential.credentialHint,
            now,
            now
          ]
        );
        await connection.execute(
          `INSERT INTO audit_events
            (user_id, project_id, action, entity_type, entity_id, metadata_json,
             created_at, updated_at, is_delete)
           VALUES (?, ?, 'agent.installation.generate', 'agent', ?, ?, ?, ?, 0)`,
          [
            request.auth!.userInternalId,
            project.id,
            agentPublicId,
            JSON.stringify({
              server_name: body.server_name,
              health_api_origin: healthApiUrl ? new URL(healthApiUrl).origin : null,
              ram_available_threshold_percent: body.ram_available_threshold_percent,
              disk_available_threshold_percent: body.disk_available_threshold_percent,
              load_5_per_core_threshold: body.load_5_per_core_threshold,
              heartbeat_interval_seconds: body.heartbeat_interval_seconds,
              telegram_alert_cooldown_seconds: body.telegram_alert_cooldown_seconds,
              checks: body.checks,
              apache_detection: APACHE_AUTO_DETECT_LABEL,
              agent_internal_id: String(result.insertId)
            }),
            now,
            now
          ]
        );
      });

      const script = generateAgentScript({
        agentId: agentPublicId,
        projectName: project.name,
        agentName: body.server_name,
        credential: credential.credential,
        centralApiUrl,
        healthApiUrl,
        checks: body.checks,
        healthRequestTimeoutSeconds: DEFAULT_HEALTH_REQUEST_TIMEOUT_SECONDS
      });
      const payload: AgentInstallationResponse = {
        agent_id: agentPublicId,
        script_filename: scriptFilename,
        script,
        crontab_entry: cronForInterval(body.heartbeat_interval_seconds, scriptPath),
        credential_shown_once: true
      };
      response.setHeader("Cache-Control", "no-store");
      response.status(201).json(payload);
    })
  );

  return router;
}
