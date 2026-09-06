import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("../../src/server/middleware/auth.js", () => ({
  authenticate: () => (request: Request, _response: Response, next: NextFunction) => {
    request.auth = {
      user: { id: "user-1", email: "admin@example.com", role: "admin" },
      userInternalId: "9",
      sessionId: "session-1",
      sessionInternalId: "10",
      csrfHash: "not-used",
      expiresAt: Date.now() + 60_000,
      jwtExpiresAt: Date.now() + 60_000
    };
    next();
  },
  requireRole: () => (_request: Request, _response: Response, next: NextFunction) => next()
}));

vi.mock("../../src/server/middleware/csrf.js", () => ({
  requireCsrf: (_request: Request, _response: Response, next: NextFunction) => next()
}));

import { errorHandler } from "../../src/server/errors.js";
import { createProjectsRouter } from "../../src/server/routes/projects.js";

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

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(createProjectsRouter(config));
  app.use(errorHandler);
  return app;
}

describe("project update route", () => {
  beforeEach(() => {
    poolExecuteMock.mockReset();
    transactionExecuteMock.mockReset();
    withTransactionMock.mockReset();
    poolExecuteMock.mockResolvedValue([
      [{ id: "21", public_id: "project-1", name: "Project Atlas", slug: "project-atlas" }],
      []
    ]);
    transactionExecuteMock.mockResolvedValue([{ affectedRows: 1 }]);
    withTransactionMock.mockImplementation(async (_config, operation) =>
      operation({ execute: transactionExecuteMock })
    );
  });

  it("updates only the project display name and records the audit event", async () => {
    const response = await request(createTestApp())
      .put("/project-1")
      .send({ name: "Project Beacon" });

    expect(response.status).toBe(204);
    expect(transactionExecuteMock.mock.calls[0]?.[1]).toEqual([
      "Project Beacon",
      expect.any(Number),
      "21"
    ]);
    const auditCall = transactionExecuteMock.mock.calls.find(([sql]) =>
      String(sql).includes("'project.update'")
    );
    expect(JSON.parse(String(auditCall?.[1]?.[3]))).toEqual({
      previous_name: "Project Atlas",
      name: "Project Beacon"
    });
  });

  it("rejects invalid or additional project fields", async () => {
    const response = await request(createTestApp())
      .put("/project-1")
      .send({ name: "A", slug: "changed" });

    expect(response.status).toBe(422);
    expect(withTransactionMock).not.toHaveBeenCalled();
  });
});
