import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { createMaintenanceBodySchema, type MaintenanceState } from "../../shared/contracts.js";
import type { Permission } from "../../shared/permissions.js";
import type { AppConfig } from "../config.js";
import { getPool, withTransaction } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { cancelMaintenanceNotifications, maintenanceTarget, readMaintenanceState } from "../services/maintenance.js";

const empty = z.object({}).strict();
const scopeSchema = z.object({ project_id: z.string().uuid(), agent_id: z.string().uuid().optional(), maintenance_id: z.string().uuid().optional() }).strict();
const DAY = 86400000;

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
      const now = Date.now(), startsAt = body.starts_at ?? now;
      if (startsAt < now - 5000 || startsAt > now + 90 * DAY || body.ends_at <= Math.max(now, startsAt) || body.ends_at - startsAt > 30 * DAY) {
        throw new AppError(422, "invalid_maintenance_time", "Choose a future end after the start, with a maximum 30-day duration and a start within 90 days.");
      }
      const state = await withTransaction(config, async connection => {
        const target = await maintenanceTarget(connection, params.project_id, params.agent_id, true);
        const [existing] = await connection.execute<RowDataPacket[]>(
          "SELECT id FROM maintenance_windows WHERE project_id = ? AND agent_id <=> ? AND is_delete = 0 AND ended_at IS NULL AND ends_at > ? LIMIT 1 FOR UPDATE", [target.projectId, target.agentId, now]);
        if (existing[0]) throw new AppError(409, "maintenance_exists", "End or cancel the existing maintenance window before creating another.");
        const publicId = randomUUID();
        await connection.execute(
          `INSERT INTO maintenance_windows (public_id, project_id, agent_id, starts_at, ends_at, reason,
           created_by_user_id, ended_at, activated_at, completed_at, created_at, updated_at, is_delete)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, 0)`,
          [publicId, target.projectId, target.agentId, startsAt, body.ends_at, body.reason, request.auth!.userInternalId, startsAt <= now ? now : null, now, now]);
        if (startsAt <= now) for (const agent of target.agents) await cancelMaintenanceNotifications(connection, String(agent.id), now);
        await connection.execute(
          `INSERT INTO audit_events (user_id, project_id, action, entity_type, entity_id, metadata_json, created_at, updated_at, is_delete)
           VALUES (?, ?, 'maintenance.create', 'maintenance_window', ?, ?, ?, ?, 0)`,
          [request.auth!.userInternalId, target.projectId, publicId, JSON.stringify({ agent_id: params.agent_id ?? null, starts_at: startsAt, ends_at: body.ends_at, reason: body.reason }), now, now]);
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
        if (Number(rows[0].starts_at) <= now) for (const agent of target.agents) await cancelMaintenanceNotifications(connection, String(agent.id), now, now - 1);
        await connection.execute("UPDATE maintenance_windows SET ended_at = ?, updated_at = ? WHERE id = ?", [now, now, rows[0].id]);
        await connection.execute(
          `INSERT INTO audit_events (user_id, project_id, action, entity_type, entity_id, metadata_json, created_at, updated_at, is_delete)
           VALUES (?, ?, 'maintenance.end', 'maintenance_window', ?, ?, ?, ?, 0)`,
          [request.auth!.userInternalId, target.projectId, maintenanceId, JSON.stringify({ agent_id: params.agent_id ?? null }), now, now]);
      });
      response.sendStatus(204);
    }));
  }
  return router;
}
