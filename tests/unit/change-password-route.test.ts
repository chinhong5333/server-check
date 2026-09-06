import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config";
import { hashPassword, sha256, verifyPassword } from "../../src/server/security/crypto";

const { execute, transaction } = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn() }));
vi.mock("../../src/server/db", () => ({ getPool: () => ({ execute }), withTransaction: transaction }));
vi.mock("../../src/server/middleware/auth", () => ({
  authenticate: () => (req: Request, res: Response, next: NextFunction) => {
    if (req.get("x-test-user") !== "admin") { res.sendStatus(401); return; }
    req.auth = { user: { id: "synthetic-user", email: "admin@example.test", role: "admin" },
      userInternalId: "12", sessionId: "synthetic-session", sessionInternalId: "15",
      csrfHash: sha256("test-csrf"), expiresAt: Date.now() + 60000, jwtExpiresAt: Date.now() + 60000 };
    next();
  }
}));
import { createAuthRouter } from "../../src/server/routes/auth";
import { errorHandler } from "../../src/server/errors";

const currentPassword = "synthetic current passphrase";
const newPassword = "synthetic replacement passphrase";
let storedHash: string;
const config = { nodeEnv: "test", publicBaseUrl: new URL("http://localhost:3000"),
  jwt: { issuer: "test", audience: "test", secret: "x".repeat(48), ttlSeconds: 900 }
} as AppConfig;
function app() { const result = express(); result.use(express.json(), createAuthRouter(config), errorHandler); return result; }
function send(body: unknown, csrf = "test-csrf") {
  return request(app()).post("/password").set("x-test-user", "admin").set("x-csrf-token", csrf).send(body);
}

describe("Password change", () => {
  beforeAll(async () => { storedHash = await hashPassword(currentPassword); });
  beforeEach(() => {
    execute.mockReset(); transaction.mockReset();
    execute.mockImplementation(async (sql: string) => sql.startsWith("SELECT")
      ? [[{ password_hash: storedHash }]] : [{ affectedRows: 1 }]);
    transaction.mockImplementation(async (_config, operation) => operation({ execute }));
  });
  it("verifies the current password, stores a hash, and revokes every session atomically", async () => {
    const response = await send({ current_password: currentPassword, new_password: newPassword });
    expect(response.status).toBe(204);
    const update = execute.mock.calls.find(([sql]) => sql.startsWith("UPDATE internal_users"));
    expect(update).toBeDefined();
    expect(await verifyPassword(newPassword, update![1][0])).toBe(true);
    expect(update![1][0]).not.toBe(newPassword);
    const revoke = execute.mock.calls.find(([sql]) => sql.startsWith("UPDATE user_sessions"));
    expect(revoke?.[0]).toContain("WHERE user_id = ?");
    expect(revoke?.[1][2]).toBe("12");
    expect(transaction).toHaveBeenCalledOnce();
    expect(JSON.stringify(execute.mock.calls)).not.toContain(newPassword);
    expect(response.headers["set-cookie"]?.[0]).toContain("Expires=Thu, 01 Jan 1970");
  });
  it("rejects an incorrect current password without writing", async () => {
    expect((await send({ current_password: "incorrect", new_password: newPassword })).status).toBe(400);
    expect(execute).toHaveBeenCalledOnce();
  });
  it("rejects short or reused passwords and unknown inputs", async () => {
    for (const body of [
      { current_password: currentPassword, new_password: "short" },
      { current_password: currentPassword, new_password: currentPassword },
      { current_password: currentPassword, new_password: newPassword, user_id: "another-user" }
    ]) expect((await send(body)).status).toBe(422);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("requires both authentication and CSRF", async () => {
    expect((await request(app()).post("/password").send({})).status).toBe(401);
    expect((await send({ current_password: currentPassword, new_password: newPassword }, "invalid")).status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });
});
