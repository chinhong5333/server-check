import { describe, expect, it } from "vitest";
import type { AppConfig } from "../../src/server/config.js";
import { issueSessionJwt, verifySessionJwt } from "../../src/server/security/jwt.js";

function config(audience = "server-check-backoffice"): AppConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 3100,
    publicBaseUrl: new URL("http://127.0.0.1:3100"),
    database: {
      host: "127.0.0.1",
      port: 3306,
      name: "server_check_test",
      user: "server_check_test",
      password: "not-used",
      connectionLimit: 1
    },
    jwt: {
      issuer: "server-check-test",
      audience,
      secret: "a".repeat(48),
      ttlSeconds: 300
    },
    sessionIdleTimeoutSeconds: 1800,
    telegram: { botToken: null, chatId: null }
  };
}

describe("JWT session contract", () => {
  it("issues and validates only the canonical session claims", async () => {
    const token = await issueSessionJwt(config(), {
      sub: "user-1",
      sid: "session-1",
      role: "admin"
    });
    const claims = await verifySessionJwt(config(), token);
    expect(claims.sub).toBe("user-1");
    expect(claims.sid).toBe("session-1");
    expect(claims.role).toBe("admin");
    expect(claims.remember_session).toBe(false);
  });

  it("issues a seven-day remembered-session claim and expiry", async () => {
    const token = await issueSessionJwt(config(), {
      sub: "user-1",
      sid: "session-1",
      role: "admin",
      remember_session: true
    }, 7 * 24 * 60 * 60);
    const claims = await verifySessionJwt(config(), token);
    expect(claims.remember_session).toBe(true);
    expect(Number(claims.exp) - Number(claims.iat)).toBe(7 * 24 * 60 * 60);
  });

  it("rejects a token for a different audience", async () => {
    const token = await issueSessionJwt(config("audience-a"), {
      sub: "user-1",
      sid: "session-1",
      role: "operator"
    });
    await expect(verifySessionJwt(config("audience-b"), token)).rejects.toThrow();
  });
});
