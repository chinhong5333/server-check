import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import type { Response } from "express";
import type { AppConfig } from "../config.js";

export interface SessionJwtClaims extends JWTPayload {
  sub: string;
  sid: string;
  role: "admin" | "operator" | "sub_admin";
  remember_session: boolean;
}

function secretKey(config: AppConfig): Uint8Array {
  return new TextEncoder().encode(config.jwt.secret);
}

export async function issueSessionJwt(
  config: AppConfig,
  claims: Pick<SessionJwtClaims, "sub" | "sid" | "role"> & Partial<Pick<SessionJwtClaims, "remember_session">>,
  ttlSeconds = config.jwt.ttlSeconds
): Promise<string> {
  return new SignJWT({ sid: claims.sid, role: claims.role, remember_session: claims.remember_session ?? false })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(config.jwt.issuer)
    .setAudience(config.jwt.audience)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey(config));
}

export async function verifySessionJwt(
  config: AppConfig,
  token: string
): Promise<SessionJwtClaims> {
  const verified = await jwtVerify(token, secretKey(config), {
    algorithms: ["HS256"],
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    requiredClaims: ["sub", "sid", "role", "iat", "exp"]
  });

  const payload = verified.payload;
  if (
    typeof payload.sub !== "string" ||
    typeof payload.sid !== "string" ||
    (payload.role !== "admin" && payload.role !== "operator" && payload.role !== "sub_admin") ||
    (payload.remember_session !== undefined && typeof payload.remember_session !== "boolean")
  ) {
    throw new Error("JWT claims are invalid.");
  }

  return {
    ...payload,
    remember_session: payload.remember_session ?? false
  } as SessionJwtClaims;
}

export function sessionCookieName(config: AppConfig): string {
  return config.nodeEnv === "production"
    ? "__Host-server_check_session"
    : "server_check_session";
}

export function setSessionCookie(
  config: AppConfig,
  response: Response,
  jwt: string,
  persistentMaxAgeSeconds?: number
): void {
  response.cookie(sessionCookieName(config), jwt, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    path: "/",
    ...(persistentMaxAgeSeconds === undefined
      ? {}
      : { maxAge: persistentMaxAgeSeconds * 1000 })
  });
}

export function clearSessionCookie(config: AppConfig, response: Response): void {
  response.clearCookie(sessionCookieName(config), {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    path: "/"
  });
}
