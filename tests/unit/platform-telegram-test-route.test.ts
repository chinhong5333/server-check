import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config.js";
import { encryptPlatformTelegramBotToken } from "../../src/server/security/telegram-secrets.js";

const { poolExecuteMock, sendTelegramMessageMock } = vi.hoisted(() => ({
  poolExecuteMock: vi.fn(),
  sendTelegramMessageMock: vi.fn()
}));

vi.mock("../../src/server/db.js", () => ({
  getPool: () => ({ execute: poolExecuteMock }),
  withTransaction: vi.fn()
}));

vi.mock("../../src/server/services/telegram.js", () => ({
  sendTelegramMessage: sendTelegramMessageMock
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
import { createSettingsRouter } from "../../src/server/routes/settings.js";

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
  app.use(createSettingsRouter(config));
  app.use(errorHandler);
  return app;
}

describe("platform Telegram test route", () => {
  const botToken = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcd";

  beforeEach(() => {
    poolExecuteMock.mockReset();
    sendTelegramMessageMock.mockReset();
    sendTelegramMessageMock.mockResolvedValue(undefined);
  });

  it("decrypts the saved sender credential and sends one test message to the saved receiver", async () => {
    poolExecuteMock.mockResolvedValue([[
      {
        id: "1",
        telegram_bot_token_encrypted: encryptPlatformTelegramBotToken(config.jwt.secret, botToken),
        telegram_chat_id: "@ops_alerts",
        is_delete: 0
      }
    ], []]);

    const response = await request(createTestApp()).post("/telegram/test").send({});

    expect(response.status).toBe(204);
    expect(sendTelegramMessageMock).toHaveBeenCalledWith({
      botToken,
      chatId: "@ops_alerts",
      text: expect.stringMatching(/^\[TEST\] Server Check/)
    });
  });

  it("rejects testing until both saved values are configured", async () => {
    poolExecuteMock.mockResolvedValue([[], []]);

    const response = await request(createTestApp()).post("/telegram/test").send({});

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("telegram_not_configured");
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it("returns a safe gateway error when Telegram rejects the message", async () => {
    poolExecuteMock.mockResolvedValue([[
      {
        id: "1",
        telegram_bot_token_encrypted: encryptPlatformTelegramBotToken(config.jwt.secret, botToken),
        telegram_chat_id: "@ops_alerts",
        is_delete: 0
      }
    ], []]);
    sendTelegramMessageMock.mockRejectedValue(new Error("Telegram returned HTTP 400."));

    const response = await request(createTestApp()).post("/telegram/test").send({});

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("telegram_test_failed");
  });
});
