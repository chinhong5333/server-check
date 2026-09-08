import { randomUUID } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { RowDataPacket } from "mysql2/promise";
import { createAdminBodySchema } from "../../shared/contracts.js";
import type { AppConfig } from "../config.js";
import { getPool, withTransaction } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { hashPassword, verifyPassword } from "../security/crypto.js";

/**
 * Creates the full-access administrator management router.
 * @param {AppConfig} config Existing authentication and database configuration.
 * @returns {Router} Admin-only, authenticated routes.
 */
export function createAdminsRouter(config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(config), requireRole("admin"));
  /**
   * GET /api/v1/admins
   * Lists active full-access administrators, without password/session information.
   * @param {import("express").Request} request Body and query must be empty.
   * @param {import("express").Response} response Array of public id, email, and created_at values.
   * @returns {Promise<void>} Resolves after the administrator list is returned.
   */
  router.get("/", asyncHandler(async (request, response) => {
    z.object({}).strict().parse(request.query);
    z.object({}).strict().parse(request.body ?? {});
    const [rows] = await getPool(config).execute<RowDataPacket[]>(
      "SELECT public_id, email, created_at FROM internal_users WHERE role = 'admin' AND is_delete = 0 ORDER BY email, id"
    );
    response.setHeader("Cache-Control", "no-store");
    response.json(rows.map((row) => ({ id: row.public_id, email: row.email, created_at: Number(row.created_at) })));
  }));
  /**
   * POST /api/v1/admins
   * Creates a full-access administrator after verifying the acting administrator's password.
   * @param {import("express").Request} request Admin/CSRF-authenticated request; query must be empty.
   * @param {string} request.body.email Unique email, trimmed/lowercased, maximum 254 characters.
   * @param {string} request.body.password New account password, 15–128 characters, stored only as a scrypt hash.
   * @param {string} request.body.current_password Acting administrator's password, 1–1024 characters.
   * @param {import("express").Response} response 201 with public id; 409 duplicate email, 400 invalid current password.
   * @returns {Promise<void>} Creates account and audit atomically; accepts no caller-selected role.
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
          `INSERT INTO internal_users (public_id, email, password_hash, role, created_at, updated_at, is_delete)
           VALUES (?, ?, ?, 'admin', ?, ?, 0)`, [publicId, body.email, passwordHash, now, now]
        );
        await connection.execute(
          `INSERT INTO audit_events (user_id, action, entity_type, entity_id, metadata_json, created_at, updated_at, is_delete)
           VALUES (?, 'admin.create', 'internal_user', ?, ?, ?, ?, 0)`,
          [request.auth!.userInternalId, publicId, JSON.stringify({ email: body.email, role: "admin" }), now, now]
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") throw new AppError(409, "email_exists", "An account already uses that email address.");
      throw error;
    }
    response.status(201).json({ id: publicId });
  }));
  return router;
}
