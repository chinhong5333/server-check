import { randomUUID } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { RowDataPacket } from "mysql2/promise";
import { createAdminBodySchema } from "../../shared/contracts.js";
import { permissionsSchema, readPermissions } from "../../shared/permissions.js";
import type { AppConfig } from "../config.js";
import { getPool, withTransaction } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { hashPassword, verifyPassword } from "../security/crypto.js";

/**
 * Creates the admin-only team management router.
 * @param {AppConfig} config Existing authentication and database configuration.
 * @returns {Router} Admin-only, authenticated routes.
 */
export function createAdminsRouter(config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(config), requireRole("admin"));
  /**
   * GET /api/v1/admins
   * Lists active admins and sub-admins, without password/session information.
   * @param {import("express").Request} request Body and query must be empty.
   * @param {import("express").Response} response Array of public id, email, role, permissions, and created_at values.
   * @returns {Promise<void>} Resolves after the administrator list is returned.
   */
  router.get("/", asyncHandler(async (request, response) => {
    z.object({}).strict().parse(request.query);
    z.object({}).strict().parse(request.body ?? {});
    const [rows] = await getPool(config).execute<RowDataPacket[]>(
      "SELECT public_id, email, role, permissions_json, created_at FROM internal_users WHERE role IN ('admin', 'sub_admin') AND is_delete = 0 ORDER BY email, id"
    );
    response.setHeader("Cache-Control", "no-store");
    response.json(rows.map((row) => ({ id: row.public_id, email: row.email, role: row.role, permissions: readPermissions(row.permissions_json), created_at: Number(row.created_at) })));
  }));
  /**
   * POST /api/v1/admins
   * Creates an admin or permission-scoped sub-admin after verifying the acting admin's password.
   * @param {import("express").Request} request Admin/CSRF-authenticated request; query must be empty.
   * @param {string} request.body.email Unique email, trimmed/lowercased, maximum 254 characters.
   * @param {string} request.body.password New account password, 8–128 characters with uppercase, lowercase, a number, and a symbol, stored only as a scrypt hash.
   * @param {string} request.body.current_password Acting administrator's password, 1–1024 characters.
   * @param {"admin"|"sub_admin"} [request.body.role="admin"] Account role; existing callers retain admin creation behavior.
   * @param {string[]} [request.body.permissions=[]] Canonical sub-admin capabilities; ignored for full admins. Project/agent actions require view_projects.
   * @param {import("express").Response} response 201 with public id; 409 duplicate email, 400 invalid current password.
   * @returns {Promise<void>} Creates account and audit atomically; only full admins may call this endpoint.
   */
  router.post("/", requireCsrf, rateLimit({ windowMs: 15 * 60_000, limit: 5,
    keyGenerator: (request) => request.auth!.userInternalId, standardHeaders: "draft-8", legacyHeaders: false }),
  asyncHandler(async (request, response) => {
    const body = createAdminBodySchema.parse(request.body);
    z.object({}).strict().parse(request.query);
    const publicId = randomUUID();
    try {
      await withTransaction(config, async (connection) => {
        const [actors] = await connection.execute<RowDataPacket[]>(
          "SELECT password_hash FROM internal_users WHERE id = ? AND role = 'admin' AND is_delete = 0 FOR UPDATE", [request.auth!.userInternalId]
        );
        if (!actors[0] || !await verifyPassword(body.current_password, actors[0].password_hash)) {
          throw new AppError(400, "incorrect_password", "Your current password is incorrect.");
        }
        const passwordHash = await hashPassword(body.password);
        const now = Date.now();
        await connection.execute(
          `INSERT INTO internal_users (public_id, email, password_hash, role, permissions_json, created_at, updated_at, is_delete)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)`, [publicId, body.email, passwordHash, body.role, JSON.stringify(body.role === "admin" ? [] : body.permissions), now, now]
        );
        await connection.execute(
          `INSERT INTO audit_events (user_id, action, entity_type, entity_id, metadata_json, created_at, updated_at, is_delete)
           VALUES (?, 'admin.create', 'internal_user', ?, ?, ?, ?, 0)`,
          [request.auth!.userInternalId, publicId, JSON.stringify({ email: body.email, role: body.role, permissions: body.role === "admin" ? [] : body.permissions }), now, now]
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") throw new AppError(409, "email_exists", "An account already uses that email address.");
      throw error;
    }
    response.status(201).json({ id: publicId });
  }));
  /**
   * PATCH /api/v1/admins/:user_id/permissions
   * Replaces only a sub-admin's permissions; full admins cannot be downgraded through this endpoint.
   * @param {import("express").Request} request Authenticated full admin with CSRF; query must be empty.
   * @param {string} request.params.user_id Public UUID of the sub-admin.
   * @param {string[]} request.body.permissions Unique canonical permission keys; project/agent actions require view_projects.
   * @param {string} request.body.current_password Acting admin's current password.
   * @param {import("express").Response} response 204 on success; 400 incorrect password; 404 no matching sub-admin.
   * @returns {Promise<void>} Updates permissions and audit atomically. Next authenticated request uses the new grants.
   */
  router.patch("/:user_id/permissions", requireCsrf, rateLimit({ windowMs: 15 * 60000, limit: 10,
    keyGenerator: request => request.auth!.userInternalId, standardHeaders: "draft-8", legacyHeaders: false }),
  asyncHandler(async (request, response) => {
    const id = z.string().uuid().parse(request.params.user_id);
    const body = z.object({ permissions: permissionsSchema, current_password: z.string().min(1).max(1024) }).strict().parse(request.body);
    z.object({}).strict().parse(request.query);
    await withTransaction(config, async connection => {
      const [actors] = await connection.execute<RowDataPacket[]>("SELECT password_hash FROM internal_users WHERE id = ? AND role = 'admin' AND is_delete = 0 FOR UPDATE", [request.auth!.userInternalId]);
      if (!actors[0] || !await verifyPassword(body.current_password, actors[0].password_hash)) throw new AppError(400, "incorrect_password", "Your current password is incorrect.");
      const [targets] = await connection.execute<RowDataPacket[]>("SELECT id FROM internal_users WHERE public_id = ? AND role = 'sub_admin' AND is_delete = 0 FOR UPDATE", [id]);
      if (!targets[0]) throw new AppError(404, "sub_admin_not_found", "The selected sub-admin no longer exists.");
      const now = Date.now();
      await connection.execute("UPDATE internal_users SET permissions_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(body.permissions), now, targets[0].id]);
      await connection.execute(`INSERT INTO audit_events (user_id, action, entity_type, entity_id, metadata_json, created_at, updated_at, is_delete)
        VALUES (?, 'team.permissions.update', 'internal_user', ?, ?, ?, ?, 0)`, [request.auth!.userInternalId, id, JSON.stringify({ permissions: body.permissions }), now, now]);
    });
    response.sendStatus(204);
  }));
  return router;
}
