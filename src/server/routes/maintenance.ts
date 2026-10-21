import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { createMaintenanceBodySchema, type MaintenanceState } from "../../shared/contracts.js";
import type { Permission } from "../../shared/permissions.js";
import type { AppConfig } from "../config.js";
import { getPool, withTransaction } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { authenticate, requirePermission, requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { cancelMaintenanceNotifications, maintenanceTarget, readMaintenanceState } from "../services/maintenance.js";

const empty = z.object({}).strict();
const scopeSchema = z.object({ project_id: z.string().uuid(), agent_id: z.string().uuid().optional(), maintenance_id: z.string().uuid().optional() }).strict();
const batchParamsSchema = z.object({ batch_id: z.string().uuid() }).strict();
const DAY = 86400000;

type MaintenanceTarget = Awaited<ReturnType<typeof maintenanceTarget>>;

/** Rejects past, over-long, or far-future windows; returns the effective start in Unix milliseconds. */
function windowStart(body: z.infer<typeof createMaintenanceBodySchema>, now: number): number {
  const startsAt = body.starts_at ?? now;
  if (startsAt < now - 5000 || startsAt > now + 90 * DAY || body.ends_at <= Math.max(now, startsAt) || body.ends_at - startsAt > 30 * DAY) {
    throw new AppError(422, "invalid_maintenance_time", "Choose a future end after the start, with a maximum 30-day duration and a start within 90 days.");
  }
  return startsAt;
}

/** Inserts one window, mutes its agents when it starts now, and audits it. Caller holds the project lock. */
async function insertWindow(connection: PoolConnection, target: MaintenanceTarget, window: {
  startsAt: number; endsAt: number; reason: string; agentPublicId: string | null; batchId: string | null;
}, userId: string, now: number): Promise<void> {
  const publicId = randomUUID();
  await connection.execute(
    `INSERT INTO maintenance_windows (public_id, project_id, agent_id, starts_at, ends_at, reason,
     created_by_user_id, ended_at, activated_at, completed_at, created_at, updated_at, is_delete, batch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, 0, ?)`,
    [publicId, target.projectId, target.agentId, window.startsAt, window.endsAt, window.reason, userId, window.startsAt <= now ? now : null, now, now, window.batchId]);
  if (window.startsAt <= now) for (const agent of target.agents) await cancelMaintenanceNotifications(connection, String(agent.id), now);
  await connection.execute(
    `INSERT INTO audit_events (user_id, project_id, action, entity_type, entity_id, metadata_json, created_at, updated_at, is_delete)
     VALUES (?, ?, 'maintenance.create', 'maintenance_window', ?, ?, ?, ?, 0)`,
    [userId, target.projectId, publicId, JSON.stringify({ agent_id: window.agentPublicId, starts_at: window.startsAt, ends_at: window.endsAt, reason: window.reason,
      ...(window.batchId ? { batch_id: window.batchId } : {}) }), now, now]);
}

/** Ends one open window, cancelling messages queued during it, and audits it. Caller holds the project lock. */
async function endWindow(connection: PoolConnection, target: MaintenanceTarget, window: {
  id: string; publicId: string; startsAt: number; agentPublicId: string | null; batchId: string | null;
}, userId: string, now: number): Promise<void> {
  if (window.startsAt <= now) for (const agent of target.agents) await cancelMaintenanceNotifications(connection, String(agent.id), now, now - 1);
  await connection.execute("UPDATE maintenance_windows SET ended_at = ?, updated_at = ? WHERE id = ?", [now, now, window.id]);
  await connection.execute(
    `INSERT INTO audit_events (user_id, project_id, action, entity_type, entity_id, metadata_json, created_at, updated_at, is_delete)
     VALUES (?, ?, 'maintenance.end', 'maintenance_window', ?, ?, ?, ?, 0)`,
    [userId, target.projectId, window.publicId, JSON.stringify({ agent_id: window.agentPublicId, ...(window.batchId ? { batch_id: window.batchId } : {}) }), now, now]);
}

/**
 * Registers authenticated project/agent maintenance APIs with independent setting permissions.
 * @param {AppConfig} config Server database and authentication configuration.
 * @returns {Router} Maintenance route collection.
 */
export function createMaintenanceRouter(config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(config), requirePermission("view_projects"));
  for (const [path, permission] of [
    ["/:project_id/maintenance", "edit_project_settings"],
    ["/:project_id/agents/:agent_id/maintenance", "edit_agent_settings"]
  ] as const) {
    /**
     * GET /api/v1/projects/:project_id/maintenance
     * GET /api/v1/projects/:project_id/agents/:agent_id/maintenance
     * Returns current/upcoming own maintenance and inherited project maintenance.
     * @param {Request} request Authenticated viewer request; body and query must be empty.
     * @param {string} request.params.project_id Active project's public UUID.
     * @param {string} [request.params.agent_id] Active agent's public UUID belonging to the project.
     * @param {import("express").Response<MaintenanceState>} response Own/inherited windows and server_time, with Cache-Control: no-store.
     * @returns {Promise<void>} Returns 200, or 404 for an unavailable scope.
     */
    router.get(path, asyncHandler(async (request, response) => {
      const params = scopeSchema.parse(request.params);
      empty.parse(request.query); empty.parse(request.body ?? {});
      const target = await maintenanceTarget(getPool(config), params.project_id, params.agent_id);
      response.setHeader("Cache-Control", "no-store");
      response.json(await readMaintenanceState(getPool(config), target.projectId, target.agentId, Date.now()));
    }));

    /**
     * POST /api/v1/projects/:project_id/maintenance
     * POST /api/v1/projects/:project_id/agents/:agent_id/maintenance
     * Creates one quiet period without stopping monitoring; requires matching edit permission and CSRF.
     * @param {Request} request Authenticated manager request; query must be empty.
     * @param {string} request.params.project_id Active project's public UUID.
     * @param {string} [request.params.agent_id] Active agent's public UUID belonging to the project.
     * @param {number|null} request.body.starts_at Unix milliseconds, or null to start immediately; at most 90 days ahead.
     * @param {number} request.body.ends_at Future Unix milliseconds after starts_at; duration at most 30 days.
     * @param {string} request.body.reason Trimmed reason, 3–500 characters.
     * @param {import("express").Response<MaintenanceState>} response Updated own/inherited maintenance state.
     * @returns {Promise<void>} Returns 201 after atomic window/audit persistence; 409 if the target already has a current/upcoming window.
     */
    router.post(path, requirePermission(permission as Permission), requireCsrf, asyncHandler(async (request, response) => {
      const params = scopeSchema.parse(request.params);
      empty.parse(request.query);
      const body = createMaintenanceBodySchema.parse(request.body);
      const now = Date.now(), startsAt = windowStart(body, now);
      const state = await withTransaction(config, async connection => {
        const target = await maintenanceTarget(connection, params.project_id, params.agent_id, true);
        const [existing] = await connection.execute<RowDataPacket[]>(
          "SELECT id FROM maintenance_windows WHERE project_id = ? AND agent_id <=> ? AND is_delete = 0 AND ended_at IS NULL AND ends_at > ? LIMIT 1 FOR UPDATE", [target.projectId, target.agentId, now]);
        if (existing[0]) throw new AppError(409, "maintenance_exists", "End or cancel the existing maintenance window before creating another.");
        await insertWindow(connection, target, { startsAt, endsAt: body.ends_at, reason: body.reason, agentPublicId: params.agent_id ?? null, batchId: null },
          request.auth!.userInternalId, now);
        return readMaintenanceState(connection, target.projectId, target.agentId, now);
      });
      response.status(201).json(state);
    }));

    /**
     * DELETE /api/v1/projects/:project_id/maintenance/:maintenance_id
     * DELETE /api/v1/projects/:project_id/agents/:agent_id/maintenance/:maintenance_id
     * Ends/cancels the exact scoped window, preserving history; matching edit permission and CSRF are required.
     * @param {Request} request Authenticated manager request; body and query must be empty.
     * @param {string} request.params.project_id Active project's public UUID.
     * @param {string} [request.params.agent_id] Active agent's public UUID belonging to the project.
     * @param {string} request.params.maintenance_id Public UUID of a window belonging to that exact scope.
     * @param {import("express").Response<void>} response Empty success response.
     * @returns {Promise<void>} Returns 204; current-state-only alert resumption is processed within the next five-second worker tick.
     */
    router.delete(`${path}/:maintenance_id`, requirePermission(permission as Permission), requireCsrf, asyncHandler(async (request, response) => {
      const params = scopeSchema.parse(request.params);
      const maintenanceId = z.string().uuid().parse(params.maintenance_id);
      empty.parse(request.query); empty.parse(request.body ?? {});
      const now = Date.now();
      await withTransaction(config, async connection => {
        const target = await maintenanceTarget(connection, params.project_id, params.agent_id, true);
        const [rows] = await connection.execute<RowDataPacket[]>(
          "SELECT id, starts_at, ended_at FROM maintenance_windows WHERE public_id = ? AND project_id = ? AND agent_id <=> ? AND is_delete = 0 FOR UPDATE", [maintenanceId, target.projectId, target.agentId]);
        if (!rows[0]) throw new AppError(404, "maintenance_not_found", "The selected maintenance window does not exist in this scope.");
        if (rows[0].ended_at !== null) return;
        await endWindow(connection, target, { id: rows[0].id, publicId: maintenanceId, startsAt: Number(rows[0].starts_at), agentPublicId: params.agent_id ?? null, batchId: null },
          request.auth!.userInternalId, now);
      });
      response.sendStatus(204);
    }));
  }
  return router;
}

/** Reads the newest current/upcoming all-projects batch, reported as a project-scoped window keyed by batch ID. */
async function readBatchState(connection: Pool | PoolConnection, now: number): Promise<MaintenanceState> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT w.batch_id, w.starts_at, w.ends_at, w.reason FROM maintenance_windows w
     INNER JOIN projects p ON p.id = w.project_id AND p.is_delete = 0
     WHERE w.batch_id IS NOT NULL AND w.agent_id IS NULL AND w.is_delete = 0 AND w.ended_at IS NULL AND w.ends_at > ?
     ORDER BY w.id DESC LIMIT 1`, [now]);
  const row = rows[0];
  return {
    own: row ? { id: String(row.batch_id), scope: "project", starts_at: Number(row.starts_at), ends_at: Number(row.ends_at), reason: String(row.reason),
      status: Number(row.starts_at) <= now ? "active" : "scheduled" } : null,
    inherited: null,
    server_time: now
  };
}

/**
 * Registers the all-projects maintenance API: one batch of project windows created and ended together.
 * Viewers can read the current batch; only admins can create or end it.
 * @param {AppConfig} config Server database and authentication configuration.
 * @returns {Router} All-projects maintenance route collection.
 */
export function createAllProjectsMaintenanceRouter(config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(config), requirePermission("view_projects"));

  /**
   * GET /api/v1/maintenance/all-projects
   * @param {Request} request Authenticated viewer request; body and query must be empty.
   * @param {import("express").Response<MaintenanceState>} response `own` is the current/upcoming batch (id = batch ID) or null; Cache-Control: no-store.
   * @returns {Promise<void>} Returns 200.
   */
  router.get("/", asyncHandler(async (request, response) => {
    empty.parse(request.query); empty.parse(request.body ?? {});
    response.setHeader("Cache-Control", "no-store");
    response.json(await readBatchState(getPool(config), Date.now()));
  }));

  /**
   * POST /api/v1/maintenance/all-projects
   * Creates a project window on every active project without a current/upcoming project window; admin and CSRF required.
   * @param {Request} request Authenticated admin request; query must be empty.
   * @param {number|null} request.body.starts_at Unix milliseconds, or null to start immediately; at most 90 days ahead.
   * @param {number} request.body.ends_at Future Unix milliseconds after starts_at; duration at most 30 days.
   * @param {string} request.body.reason Trimmed reason, 3–500 characters.
   * @param {import("express").Response<MaintenanceState>} response The new batch state.
   * @returns {Promise<void>} Returns 201; 409 when a batch is already current or every project already has a window.
   */
  router.post("/", requireRole("admin"), requireCsrf, asyncHandler(async (request, response) => {
    empty.parse(request.query);
    const body = createMaintenanceBodySchema.parse(request.body);
    const now = Date.now(), startsAt = windowStart(body, now);
    const state = await withTransaction(config, async connection => {
      if ((await readBatchState(connection, now)).own) {
        throw new AppError(409, "maintenance_exists", "End or cancel the current all-projects maintenance before creating another.");
      }
      const [projects] = await connection.execute<RowDataPacket[]>("SELECT public_id FROM projects WHERE is_delete = 0 ORDER BY id");
      const batchId = randomUUID();
      let created = 0;
      for (const project of projects) {
        const target = await maintenanceTarget(connection, String(project.public_id), undefined, true);
        const [existing] = await connection.execute<RowDataPacket[]>(
          "SELECT id FROM maintenance_windows WHERE project_id = ? AND agent_id IS NULL AND is_delete = 0 AND ended_at IS NULL AND ends_at > ? LIMIT 1 FOR UPDATE",
          [target.projectId, now]);
        if (existing[0]) continue;
        await insertWindow(connection, target, { startsAt, endsAt: body.ends_at, reason: body.reason, agentPublicId: null, batchId }, request.auth!.userInternalId, now);
        created++;
      }
      if (!created) throw new AppError(409, "maintenance_exists", "Every project already has maintenance scheduled or active.");
      return readBatchState(connection, now);
    });
    response.status(201).json(state);
  }));

  /**
   * DELETE /api/v1/maintenance/all-projects/:batch_id
   * Ends/cancels every open window in the batch, preserving history; admin and CSRF required.
   * @param {Request} request Authenticated admin request; body and query must be empty.
   * @param {string} request.params.batch_id Batch UUID returned as `own.id` by GET/POST.
   * @param {import("express").Response<void>} response Empty success response.
   * @returns {Promise<void>} Returns 204, or 404 for an unknown batch.
   */
  router.delete("/:batch_id", requireRole("admin"), requireCsrf, asyncHandler(async (request, response) => {
    const { batch_id: batchId } = batchParamsSchema.parse(request.params);
    empty.parse(request.query); empty.parse(request.body ?? {});
    const now = Date.now();
    await withTransaction(config, async connection => {
      const [projects] = await connection.execute<RowDataPacket[]>(
        `SELECT DISTINCT p.id, p.public_id FROM maintenance_windows w INNER JOIN projects p ON p.id = w.project_id AND p.is_delete = 0
         WHERE w.batch_id = ? AND w.agent_id IS NULL AND w.is_delete = 0 ORDER BY p.id`, [batchId]);
      if (!projects[0]) throw new AppError(404, "maintenance_not_found", "The selected maintenance does not exist.");
      for (const project of projects) {
        const target = await maintenanceTarget(connection, String(project.public_id), undefined, true);
        const [rows] = await connection.execute<RowDataPacket[]>(
          "SELECT id, public_id, starts_at, ended_at FROM maintenance_windows WHERE batch_id = ? AND project_id = ? AND agent_id IS NULL AND is_delete = 0 FOR UPDATE",
          [batchId, target.projectId]);
        for (const row of rows) {
          if (row.ended_at !== null) continue;
          await endWindow(connection, target, { id: row.id, publicId: String(row.public_id), startsAt: Number(row.starts_at), agentPublicId: null, batchId },
            request.auth!.userInternalId, now);
        }
      }
    });
    response.sendStatus(204);
  }));
  return router;
}
