import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { readPermissions } from "../../shared/permissions.js";
import rateLimit from "express-rate-limit";
import type { RowDataPacket } from "mysql2/promise";
import {
  loginBodySchema,
  changePasswordBodySchema,
  REMEMBER_SESSION_SECONDS,
  type SessionResponse
} from "../../shared/contracts.js";
import type { AppConfig } from "../config.js";
import { getPool, withTransaction } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { authenticate } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { csrfTokenForSession, hashPassword, sha256, verifyPassword } from "../security/crypto.js";
import { clearSessionCookie, issueSessionJwt, setSessionCookie } from "../security/jwt.js";

interface UserRow extends RowDataPacket {
  id: string;
  public_id: string;
  email: string;
  password_hash: string;
  role: "admin" | "operator" | "sub_admin";
  permissions_json: unknown;
  failed_login_count: number;
  locked_until: string | null;
}

const genericLoginError = new AppError(
  401,
  "invalid_credentials",
  "The email address or password is incorrect."
);

export function createAuthRouter(config: AppConfig): Router {
  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: {
        code: "login_rate_limited",
        message: "Too many sign-in attempts. Try again in 15 minutes."
      }
    }
  });

  /**
   * POST /api/v1/auth/login
   * Authenticates an internal user and creates a revocable JWT-backed session.
   * @param {Request<{}, {}, {email: string, password: string, remember_session?: boolean}>} request Express request with canonical body.email, body.password, and optional body.remember_session fields.
   * @param {string} request.body.email Internal account email address.
   * @param {string} request.body.password Internal account password.
   * @param {boolean} [request.body.remember_session=false] Persists the revocable session cookie for seven days when true.
   * @param {import("express").Response<SessionResponse>} response Express response that sets the HttpOnly session cookie.
   * @returns {Promise<void>} Resolves after the session and audit event are persisted.
   */
  router.post(
    "/login",
    loginLimiter,
    asyncHandler(async (request: Request, response) => {
      const body = loginBodySchema.parse(request.body);
      const email = body.email.toLowerCase();
      const [rows] = await getPool(config).execute<UserRow[]>(
        `SELECT id, public_id, email, password_hash, role, permissions_json, failed_login_count, locked_until
         FROM internal_users
         WHERE email = ? AND is_delete = 0
         LIMIT 1`,
        [email]
      );
      const user = rows[0];
      const now = Date.now();

      if (!user || (user.locked_until && Number(user.locked_until) > now)) {
        throw genericLoginError;
      }

      const validPassword = await verifyPassword(body.password, user.password_hash);
      if (!validPassword) {
        const attempts = Number(user.failed_login_count) + 1;
        const lockedUntil = attempts >= 5 ? now + 15 * 60 * 1000 : null;
        await getPool(config).execute(
          `UPDATE internal_users
           SET failed_login_count = ?, locked_until = ?, updated_at = ?
           WHERE id = ?`,
          [attempts >= 5 ? 0 : attempts, lockedUntil, now, user.id]
        );
        throw genericLoginError;
      }

      const sessionId = randomUUID();
      const csrfToken = csrfTokenForSession(config.jwt.secret, sessionId);
      const sessionDurationSeconds = body.remember_session
        ? REMEMBER_SESSION_SECONDS
        : config.sessionIdleTimeoutSeconds;
      const expiresAt = now + sessionDurationSeconds * 1000;
      const userAgentHash = request.get("user-agent") ? sha256(request.get("user-agent")!) : null;

      await withTransaction(config, async (connection) => {
        const [currentUsers] = await connection.execute<UserRow[]>(
          "SELECT password_hash FROM internal_users WHERE id = ? AND is_delete = 0 FOR UPDATE",
          [user.id]
        );
        if (!currentUsers[0] || currentUsers[0].password_hash !== user.password_hash) {
          throw genericLoginError;
        }
        await connection.execute(
          `INSERT INTO user_sessions
            (public_id, user_id, csrf_hash, expires_at, last_seen_at, revoked_at,
             user_agent_hash, ip_address, created_at, updated_at, is_delete)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0)`,
          [
            sessionId,
            user.id,
            sha256(csrfToken),
            expiresAt,
            now,
            userAgentHash,
            request.ip ?? null,
            now,
            now
          ]
        );
        await connection.execute(
          `UPDATE internal_users
           SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ?
           WHERE id = ?`,
          [now, now, user.id]
        );
        await connection.execute(
          `INSERT INTO audit_events
            (user_id, project_id, action, entity_type, entity_id, metadata_json,
             created_at, updated_at, is_delete)
           VALUES (?, NULL, 'auth.login', 'user_session', ?, ?, ?, ?, 0)`,
          [
            user.id,
            sessionId,
            JSON.stringify({
              ip_address: request.ip ?? null,
              remember_session: body.remember_session,
              expires_at: expiresAt
            }),
            now,
            now
          ]
        );
      });

      const jwt = await issueSessionJwt(config, {
        sub: user.public_id,
        sid: sessionId,
        role: user.role,
        remember_session: body.remember_session
      }, body.remember_session ? REMEMBER_SESSION_SECONDS : config.jwt.ttlSeconds);
      setSessionCookie(
        config,
        response,
        jwt,
        body.remember_session ? REMEMBER_SESSION_SECONDS : undefined
      );
      const payload: SessionResponse = {
        user: { id: user.public_id, email: user.email, role: user.role, permissions: readPermissions(user.permissions_json) },
        csrf_token: csrfToken
      };
      response.status(200).json(payload);
    })
  );

  /**
   * GET /api/v1/auth/session
   * Returns the authenticated internal user's safe profile and a CSRF token.
   * @param {Request} request Authenticated Express request; request body must be empty.
   * @param {import("express").Response<SessionResponse>} response Express response without the JWT value.
   * @returns {Promise<void>} Resolves after the current session is validated.
   */
  router.get(
    "/session",
    authenticate(config),
    asyncHandler(async (request, response) => {
      const auth = request.auth!;
      response.status(200).json({
        user: auth.user,
        csrf_token: csrfTokenForSession(config.jwt.secret, auth.sessionId)
      } satisfies SessionResponse);
    })
  );

  /**
   * POST /api/v1/auth/logout
   * Revokes the current internal session and clears its JWT cookie.
   * @param {Request} request Authenticated Express request with an empty body and x-csrf-token header.
   * @param {import("express").Response<void>} response Empty Express response.
   * @returns {Promise<void>} Resolves after revocation and audit persistence.
   */
  router.post(
    "/logout",
    authenticate(config),
    requireCsrf,
    asyncHandler(async (request, response) => {
      const now = Date.now();
      const auth = request.auth!;
      await withTransaction(config, async (connection) => {
        await connection.execute(
          "UPDATE user_sessions SET revoked_at = ?, updated_at = ? WHERE id = ?",
          [now, now, auth.sessionInternalId]
        );
        await connection.execute(
          `INSERT INTO audit_events
            (user_id, project_id, action, entity_type, entity_id, metadata_json,
             created_at, updated_at, is_delete)
           VALUES (?, NULL, 'auth.logout', 'user_session', ?, ?, ?, ?, 0)`,
          [auth.userInternalId, auth.sessionId, JSON.stringify({}), now, now]
        );
      });
      clearSessionCookie(config, response);
      response.status(204).send();
    })
  );

  /**
   * POST /api/v1/auth/password
   * Changes the signed-in user's password after verifying the current password and revokes all sessions.
   * @param {Request} request Authenticated, CSRF-protected request; query must be empty.
   * @param {string} request.body.current_password Current password, 1–1024 characters.
   * @param {string} request.body.new_password Different new password, 8–128 characters with uppercase, lowercase, a number, and a symbol; never trimmed.
   * @param {import("express").Response<void>} response Clears the session cookie and sends 204.
   * @returns {Promise<void>} Persists the password hash, session revocations, and audit event atomically.
   */
  router.post(
    "/password",
    authenticate(config),
    requireCsrf,
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 5,
      keyGenerator: (request) => request.auth!.userInternalId,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: { code: "password_rate_limited", message: "Too many password change attempts. Try again in 15 minutes." } }
    }),
    asyncHandler(async (request, response) => {
      const body = changePasswordBodySchema.parse(request.body);
      if (Object.keys(request.query).length > 0) {
        throw new AppError(400, "invalid_query", "This endpoint does not accept query parameters.");
      }
      const auth = request.auth!;
      await withTransaction(config, async (connection) => {
        const [rows] = await connection.execute<UserRow[]>(
          "SELECT password_hash FROM internal_users WHERE id = ? AND is_delete = 0 FOR UPDATE",
          [auth.userInternalId]
        );
        if (!rows[0] || !await verifyPassword(body.current_password, rows[0].password_hash)) {
          throw new AppError(400, "incorrect_password", "The current password is incorrect.");
        }
        const passwordHash = await hashPassword(body.new_password);
        const now = Date.now();
        await connection.execute(
          "UPDATE internal_users SET password_hash = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
          [passwordHash, now, auth.userInternalId]
        );
        await connection.execute(
          "UPDATE user_sessions SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND revoked_at IS NULL",
          [now, now, auth.userInternalId]
        );
        await connection.execute(
          `INSERT INTO audit_events (user_id, project_id, action, entity_type, entity_id, metadata_json,
           created_at, updated_at, is_delete) VALUES (?, NULL, 'auth.password_changed', 'internal_user', ?, '{}', ?, ?, 0)`,
          [auth.userInternalId, auth.user.id, now, now]
        );
      });
      clearSessionCookie(config, response);
      response.status(204).send();
    })
  );

  return router;
}
