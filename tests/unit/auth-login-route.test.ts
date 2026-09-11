import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config.js";

const { poolExecuteMock, transactionExecuteMock, withTransactionMock } = vi.hoisted(() => ({
  poolExecuteMock: vi.fn(),
  transactionExecuteMock: vi.fn(),
  withTransactionMock: vi.fn()
}));

vi.mock("../../src/server/db.js", () => ({
  getPool: () => ({ execute: poolExecuteMock }),
  withTransaction: withTransactionMock
}));

vi.mock("../../src/server/security/crypto.js", () => ({
  csrfTokenForSession: () => "csrf-token",
  sha256: (value: string) => `hash:${value}`,
  verifyPassword: vi.fn().mockResolvedValue(true)
}));

import { errorHandler } from "../../src/server/errors.js";
import { createAuthRouter } from "../../src/server/routes/auth.js";

const config: AppConfig = {
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
    audience: "server-check-backoffice-test",
    secret: "a".repeat(48),
    ttlSeconds: 300
  },
  sessionIdleTimeoutSeconds: 1800
};

const fixedNow = 1_788_253_200_000;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(createAuthRouter(config));
  app.use(errorHandler);
  return app;
}

describe("remembered login session", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    poolExecuteMock.mockReset();
    transactionExecuteMock.mockReset();
    withTransactionMock.mockReset();
    poolExecuteMock.mockResolvedValue([[
      {
        id: "9",
        public_id: "user-1",
        email: "admin@example.com",
        password_hash: "stored-hash",
        role: "admin",
        failed_login_count: 0,
        locked_until: null
      }
    ], []]);
    transactionExecuteMock.mockImplementation(async (sql: string) =>
      sql.startsWith("SELECT password_hash") ? [[{ password_hash: "stored-hash" }]] : [{ affectedRows: 1 }]
    );
    withTransactionMock.mockImplementation(async (_config, operation) =>
      operation({ execute: transactionExecuteMock })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("blocks a disabled account before password verification creates a session", async () => {
    poolExecuteMock.mockResolvedValue([[{id:"9",role:"sub_admin",is_disabled:1,password_hash:"stored-hash"}]]);
    const response=await request(createTestApp()).post("/login").send({email:"sub@example.com",password:"secret",remember_session:false});
    expect(response.status).toBe(401);
    expect(withTransactionMock).not.toHaveBeenCalled();
  });
  it("rechecks disabled status under the login lock", async () => {
    transactionExecuteMock.mockResolvedValue([[{password_hash:"stored-hash",is_disabled:1}]]);
    const response=await request(createTestApp()).post("/login").send({email:"admin@example.com",password:"secret",remember_session:false});
    expect(response.status).toBe(401);
    expect(transactionExecuteMock.mock.calls.some(([sql])=>sql.includes("INSERT INTO user_sessions"))).toBe(false);
  });

  it("persists the cookie and server session for seven days when requested", async () => {
    const response = await request(createTestApp())
      .post("/login")
      .set("user-agent", "remember-session-test")
      .send({ email: "admin@example.com", password: "secret", remember_session: true });

    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]?.[0]).toContain("Max-Age=604800");
    const sessionInsert = transactionExecuteMock.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO user_sessions")
    );
    expect(sessionInsert?.[1]?.[3]).toBe(fixedNow + 7 * 24 * 60 * 60 * 1000);
  });

  it("uses a browser-session cookie and the configured short expiry by default", async () => {
    const response = await request(createTestApp())
      .post("/login")
      .send({ email: "admin@example.com", password: "secret" });

    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]?.[0]).not.toContain("Max-Age=");
    const sessionInsert = transactionExecuteMock.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO user_sessions")
    );
    expect(sessionInsert?.[1]?.[3]).toBe(fixedNow + config.sessionIdleTimeoutSeconds * 1000);
  });

  it("does not create a session if the password changes before the login transaction", async () => {
    transactionExecuteMock.mockResolvedValue([[{ password_hash: "replacement-hash" }]]);
    const response = await request(createTestApp()).post("/login")
      .send({ email: "admin@example.com", password: "secret" });
    expect(response.status).toBe(401);
    expect(transactionExecuteMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO user_sessions"))).toBe(false);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });
});
