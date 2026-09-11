import type { NextFunction, Request, Response } from "express";
import type { RowDataPacket } from "mysql2/promise";
import type { AppConfig } from "../config.js";
import { getPool } from "../db.js";
import { hasPermission, readPermissions, type Permission } from "../../shared/permissions.js";
import { AppError } from "../errors.js";
import { issueSessionJwt, sessionCookieName, setSessionCookie, verifySessionJwt } from "../security/jwt.js";

interface SessionRow extends RowDataPacket {
  session_internal_id: string;
  session_public_id: string;
  user_internal_id: string;
  user_public_id: string;
  email: string;
  role: "admin" | "operator" | "sub_admin";
  permissions_json: unknown;
  is_disabled: number;
  csrf_hash: string;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at: string;
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const item of header.split(";")) {
    const [key, ...valueParts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return null;
}

export function authenticate(config: AppConfig) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const token = parseCookie(request.headers.cookie, sessionCookieName(config));
      if (!token) throw new AppError(401, "authentication_required", "Sign in to continue.");

      const claims = await verifySessionJwt(config, token).catch(() => {
        throw new AppError(401, "invalid_session", "Your session is invalid or expired. Sign in again.");
      });

      const [rows] = await getPool(config).execute<SessionRow[]>(
        `SELECT
           s.id AS session_internal_id,
           s.public_id AS session_public_id,
           s.csrf_hash,
           s.expires_at,
           s.revoked_at,
           s.last_seen_at,
           u.id AS user_internal_id,
           u.public_id AS user_public_id,
           u.email,
           u.role, u.permissions_json, u.is_disabled
         FROM user_sessions s
         INNER JOIN internal_users u ON u.id = s.user_id
         WHERE s.public_id = ? AND s.is_delete = 0 AND u.is_delete = 0
         LIMIT 1`,
        [claims.sid]
      );

      const session = rows[0];
      const now = Date.now();
      if (
        !session ||
        Number(session.is_disabled) === 1 ||
        session.user_public_id !== claims.sub ||
        session.revoked_at !== null ||
        Number(session.expires_at) <= now
      ) {
        throw new AppError(401, "invalid_session", "Your session is invalid or expired. Sign in again.");
      }

      request.auth = {
        user: {
          id: session.user_public_id,
          email: session.email,
          role: session.role,
          permissions: readPermissions(session.permissions_json)
        },
        userInternalId: session.user_internal_id,
        sessionId: session.session_public_id,
        sessionInternalId: session.session_internal_id,
        csrfHash: session.csrf_hash,
        expiresAt: Number(session.expires_at),
        jwtExpiresAt: Number(claims.exp ?? 0) * 1000
      };

      if (now - Number(session.last_seen_at) >= 60_000) {
        await getPool(config).execute(
          "UPDATE user_sessions SET last_seen_at = ?, updated_at = ? WHERE id = ?",
          [now, now, session.session_internal_id]
        );
      }

      if (request.auth.jwtExpiresAt - now <= 300_000) {
        const remainingSessionSeconds = Math.max(1, Math.floor((request.auth.expiresAt - now) / 1000));
        const renewedTtlSeconds = Math.min(
          claims.remember_session ? remainingSessionSeconds : config.jwt.ttlSeconds,
          remainingSessionSeconds
        );
        const renewed = await issueSessionJwt(config, {
          sub: request.auth.user.id,
          sid: request.auth.sessionId,
          role: request.auth.user.role,
          remember_session: claims.remember_session
        }, renewedTtlSeconds);
        setSessionCookie(
          config,
          response,
          renewed,
          claims.remember_session ? remainingSessionSeconds : undefined
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRole(role: "admin" | "operator") {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const currentRole = request.auth?.user.role;
    if (!currentRole || (role === "admin" && currentRole !== "admin")) {
      next(new AppError(403, "permission_denied", "Your account cannot perform this action."));
      return;
    }
    next();
  };
}

/**
 * Enforces a current database-backed permission after authentication.
 * @param {Permission} permission Canonical capability required by the endpoint.
 * @returns {import("express").RequestHandler} Returns 403 without executing the handler when access is denied.
 */
export function requirePermission(permission: Permission) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (!hasPermission(request.auth?.user, permission)) {
      next(new AppError(403, "permission_denied", "Your account cannot perform this action.")); return;
    }
    next();
  };
}
