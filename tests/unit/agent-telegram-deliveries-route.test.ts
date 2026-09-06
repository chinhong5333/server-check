import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config.js";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../src/server/db.js", () => ({
  getPool: () => ({ execute: executeMock })
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
  }
}));

import { errorHandler } from "../../src/server/errors.js";
import { createAgentsRouter } from "../../src/server/routes/agents.js";

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
  app.use(createAgentsRouter(config));
  app.use(errorHandler);
  return app;
}

describe("agent Telegram delivery log route", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM agents a")) {
        return [[{
          id: "31",
          public_id: "agent-1",
          server_name: "atlas-web-01",
          project_public_id: "project-1"
        }], []];
      }
      if (sql.includes("FROM notification_outbox outbox")) {
        return [[{
          id: "41",
          event_type: "opened",
          incident_type: "heartbeat_missed",
          probable_cause: "Heartbeat overdue",
          status: "sent",
          attempt_count: 1,
          next_attempt_at: "1788252000000",
          sent_at: "1788252001000",
          last_error: null,
          created_at: "1788252000000"
        }], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
  });

  it("returns recent delivery state without exposing Telegram credentials", async () => {
    const response = await request(createTestApp()).get("/agent-1/telegram-deliveries");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{
      id: "41",
      event_type: "opened",
      incident_type: "heartbeat_missed",
      probable_cause: "Heartbeat overdue",
      status: "sent",
      attempt_count: 1,
      queued_at: 1_788_252_000_000,
      next_attempt_at: 1_788_252_000_000,
      sent_at: 1_788_252_001_000,
      last_error: null
    }]);
    expect(JSON.stringify(response.body)).not.toContain("token");
    expect(JSON.stringify(response.body)).not.toContain("destination");
  });
});
