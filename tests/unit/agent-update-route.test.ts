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

describe("agent settings update route", () => {
  beforeEach(() => {
    poolExecuteMock.mockReset();
    transactionExecuteMock.mockReset();
    withTransactionMock.mockReset();
    poolExecuteMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM projects")) {
        return [[{ id: "21", public_id: "project-1", name: "Project Atlas", slug: "project-atlas" }], []];
      }
      if (sql.includes("FROM agents")) {
        return [[{
          id: "31",
          public_id: "agent-1",
          server_name: "atlas-web-01",
          health_api_url: "https://atlas.example.com/health",
          ram_available_threshold_percent: "15",
          disk_available_threshold_percent: "10",
          load_5_per_core_threshold: "1.5",
          heartbeat_interval_seconds: 120,
          telegram_alert_cooldown_seconds: 900
        }], []];
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    });
    transactionExecuteMock.mockResolvedValue([{ affectedRows: 1 }]);
    withTransactionMock.mockImplementation(async (_config, operation) =>
      operation({ execute: transactionExecuteMock })
    );
  });

  it("updates configuration without rotating credentials or clearing monitoring state", async () => {
    const response = await request(createTestApp())
      .put("/project-1/agents/agent-1")
      .send({
        server_name: "atlas-web-renamed",
        ram_available_threshold_percent: 15,
        disk_available_threshold_percent: 10,
        load_5_per_core_threshold: 1.5,
        heartbeat_interval_seconds: 120,
        telegram_alert_cooldown_seconds: 900
      });

    expect(response.status).toBe(204);
    const statements = transactionExecuteMock.mock.calls.map(([sql]) => String(sql));
    const updateStatement = statements.find((sql) => sql.includes("UPDATE agents"));
    expect(updateStatement).toBeDefined();
    expect(updateStatement).not.toContain("credential_hash");
    expect(updateStatement).not.toContain("credential_hint");
    expect(updateStatement).not.toContain("status =");
    expect(updateStatement).not.toContain("last_heartbeat_at");
    expect(updateStatement).not.toContain("last_metrics_at");
    expect(updateStatement).not.toContain("health_api_url");
    expect(statements.some((sql) => sql.includes("UPDATE incidents"))).toBe(false);
    expect(statements.some((sql) => sql.includes("UPDATE notification_outbox"))).toBe(false);
    expect(statements.some((sql) => sql.includes("'agent.update'"))).toBe(true);

    const auditCall = transactionExecuteMock.mock.calls.find(([sql]) =>
      String(sql).includes("'agent.update'")
    );
    expect(JSON.parse(String(auditCall?.[1]?.[3]))).toMatchObject({
      previous_server_name: "atlas-web-01",
      server_name: "atlas-web-renamed",
      credential_rotated: false
    });
  });

  it("persists optional selections and creates a script without an API URL", async () => {
    transactionExecuteMock.mockResolvedValue([{ affectedRows: 1, insertId: 31 }]);
    const checks = { apache: false, nginx: true, middleware_api: false };
    const response = await request(createTestApp()).post("/project-1/agent-installations").send({
      server_name: "nginx-test", health_api_url: null, checks,
      ram_available_threshold_percent: 15, disk_available_threshold_percent: 10,
      load_5_per_core_threshold: 1.5, heartbeat_interval_seconds: 120, telegram_alert_cooldown_seconds: 900
    });
    expect(response.status).toBe(201);
    expect(response.body.script).toContain("CHECK_NGINX=1");
    expect(response.body.script).toContain("CHECK_MIDDLEWARE_API=0");
    const insert = transactionExecuteMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO agents"));
    expect(insert?.[1][3]).toBeNull();
    expect(JSON.parse(insert?.[1][4])).toEqual(checks);
    expect(String(insert?.[0]).match(/\?/g)?.length).toBe(insert?.[1].length);
  });

  it("updates the selections during explicit replacement and clears the previous result", async () => {
    const checks = { apache: false, nginx: true, middleware_api: false };
    const response = await request(createTestApp()).post("/project-1/agents/agent-1/credential-rotation")
      .send({ health_api_url: null, checks });
    expect(response.status).toBe(200);
    const update = transactionExecuteMock.mock.calls.find(([sql]) => String(sql).includes("SET credential_hash"));
    expect(update?.[0]).toContain("last_service_checks_json = NULL");
    expect(JSON.parse(update?.[1][3])).toEqual(checks);
    expect(String(update?.[0]).match(/\?/g)?.length).toBe(update?.[1].length);
  });

  it("rotates credentials only through the explicit replacement-script endpoint", async () => {
    const response = await request(createTestApp())
      .post("/project-1/agents/agent-1/credential-rotation")
      .send({ health_api_url: "https://atlas.example.com/replacement-health" });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({
      agent_id: "agent-1",
      script_filename: "server-check-atlas-web-01.sh",
      crontab_entry: "*/2 * * * * /bin/sh '/opt/server-check/server-check-atlas-web-01.sh'",
      credential_shown_once: true
    });
    expect(response.body.script).toContain("# Agent: atlas-web-01");
    expect(response.body.script).toContain("HEALTH_API_URL='https://atlas.example.com/replacement-health'");

    const statements = transactionExecuteMock.mock.calls.map(([sql]) => String(sql));
    const credentialUpdate = statements.find((sql) => sql.includes("UPDATE agents"));
    expect(credentialUpdate).toContain("credential_hash");
    expect(credentialUpdate).toContain("health_api_url");
    expect(statements.some((sql) => sql.includes("UPDATE incidents"))).toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE notification_outbox"))).toBe(true);
    expect(statements.some((sql) => sql.includes("'agent.credential.rotate'"))).toBe(true);
  });

  it("rejects Server Health API URL changes through general agent settings", async () => {
    const response = await request(createTestApp())
      .put("/project-1/agents/agent-1")
      .send({
        server_name: "atlas-web-01",
        health_api_url: "https://atlas.example.com/not-allowed-here",
        ram_available_threshold_percent: 15,
        disk_available_threshold_percent: 10,
        load_5_per_core_threshold: 1.5,
        heartbeat_interval_seconds: 120,
        telegram_alert_cooldown_seconds: 900
      });

    expect(response.status).toBe(422);
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("requires Server Health API URL when generating a replacement script", async () => {
    const response = await request(createTestApp())
      .post("/project-1/agents/agent-1/credential-rotation")
      .send({});

    expect(response.status).toBe(422);
    expect(withTransactionMock).not.toHaveBeenCalled();
  });
});
