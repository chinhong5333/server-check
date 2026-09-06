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

describe("project deletion route", () => {
  beforeEach(() => {
    poolExecuteMock.mockReset();
    transactionExecuteMock.mockReset();
    withTransactionMock.mockReset();
    poolExecuteMock.mockResolvedValue([
      [
        {
          id: "21",
          public_id: "project-1",
          name: "Project Atlas",
          slug: "project-atlas",
          ram_available_threshold_percent: "15",
          disk_available_threshold_percent: "10",
          load_5_per_core_threshold: "1",
          heartbeat_interval_seconds: 120,
          healthy_agents: 0,
          new_agents: 0,
          warning_agents: 0,
          critical_agents: 0,
          stale_agents: 0
        }
      ],
      []
    ]);
    transactionExecuteMock.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE projects")) return [{ affectedRows: 1 }];
      if (sql.includes("UPDATE agents")) return [{ affectedRows: 2 }];
      return [{ affectedRows: 1 }];
    });
    withTransactionMock.mockImplementation(async (_config, operation) =>
      operation({ execute: transactionExecuteMock })
    );
  });

  it("soft-deletes the project and revokes its active agents after exact confirmation", async () => {
    const response = await request(createTestApp())
      .delete("/project-1")
      .send({ confirmation_name: "Project Atlas" });

    expect(response.status).toBe(204);
    const statements = transactionExecuteMock.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("UPDATE projects"))).toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE agents"))).toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE incidents"))).toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE notification_outbox"))).toBe(true);
    expect(statements.some((sql) => sql.includes("'project.delete'"))).toBe(true);

    const auditCall = transactionExecuteMock.mock.calls.find(([sql]) =>
      String(sql).includes("'project.delete'")
    );
    expect(JSON.parse(String(auditCall?.[1]?.[3]))).toMatchObject({
      name: "Project Atlas",
      revoked_agent_count: 2,
      history_retained: true
    });
  });

  it("rejects a confirmation name that does not exactly match", async () => {
    const response = await request(createTestApp())
      .delete("/project-1")
      .send({ confirmation_name: "project atlas" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("project_confirmation_mismatch");
    expect(withTransactionMock).not.toHaveBeenCalled();
  });
});
