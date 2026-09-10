import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptPlatformTelegramBotToken } from "../../src/server/security/telegram-secrets";
import type { AppConfig } from "../../src/server/config";
const { execute, discover, transaction, botLink } = vi.hoisted(() => ({ execute: vi.fn(), discover: vi.fn(), transaction: vi.fn(), botLink: vi.fn() }));
vi.mock("../../src/server/db", () => ({ getPool: () => ({ execute }), withTransaction: transaction }));
vi.mock("../../src/server/services/telegram-chat-discovery", () => ({ discoverTelegramChats: discover, getTelegramBotLink: botLink }));
vi.mock("../../src/server/middleware/auth", async original => ({
  ...await original<typeof import("../../src/server/middleware/auth")>(),
  authenticate: () => (req: Request, res: Response, next: NextFunction) => {
    const role = req.get("x-test-role");
    if (role !== "admin" && role !== "operator") { res.sendStatus(401); return; }
    req.auth = { user: { id: "test-admin", email: "admin@example.test", role }, userInternalId: "9", sessionId: "session-test",
      sessionInternalId: "10", csrfHash: "unused", expiresAt: Date.now() + 60000, jwtExpiresAt: Date.now() + 60000 }; next();
  }
}));
import { createSettingsRouter } from "../../src/server/routes/settings";
import { errorHandler } from "../../src/server/errors";
const config = { jwt: { secret: "a".repeat(48) } } as AppConfig;
function app() { const app = express(); app.use(express.json(), createSettingsRouter(config), errorHandler); return app; }
describe("Telegram chat discovery route", () => {
  beforeEach(() => { execute.mockReset(); discover.mockReset(); transaction.mockReset(); botLink.mockReset(); });
  it("protects bot links and uses only the saved credential without exposing it", async () => {
    expect((await request(app()).get("/telegram/bot-link")).status).toBe(401);
    expect((await request(app()).get("/telegram/bot-link").set("x-test-role", "operator")).status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
    const token = "123456789:synthetic-token-for-testing";
    execute.mockResolvedValue([[{ telegram_bot_token_encrypted: encryptPlatformTelegramBotToken(config.jwt.secret, token) }]]);
    botLink.mockResolvedValue({ username: "MonitorTestBot", url: "https://t.me/MonitorTestBot" });
    const response = await request(app()).get("/telegram/bot-link").set("x-test-role", "admin");
    expect(response.status).toBe(200);
    expect(response.body.url).toBe("https://t.me/MonitorTestBot");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.text).not.toContain(token);
    expect(botLink).toHaveBeenCalledWith(token);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("rejects missing bot tokens and query inputs for bot links", async () => {
    execute.mockResolvedValue([[]]);
    expect((await request(app()).get("/telegram/bot-link").set("x-test-role", "admin")).status).toBe(409);
    expect((await request(app()).get("/telegram/bot-link?token=bad").set("x-test-role", "admin")).status).toBe(422);
    expect(botLink).not.toHaveBeenCalled();
  });
  it("requires an authenticated admin before database access or Telegram calls", async () => {
    expect((await request(app()).get("/telegram/chats")).status).toBe(401);
    expect((await request(app()).get("/telegram/chats").set("x-test-role", "operator")).status).toBe(403);
    expect(execute).not.toHaveBeenCalled(); expect(discover).not.toHaveBeenCalled();
  });
  it("uses only the saved encrypted sender and returns no token", async () => {
    const token = "123456789:synthetic-token-for-testing";
    execute.mockResolvedValue([[{ telegram_bot_token_encrypted: encryptPlatformTelegramBotToken(config.jwt.secret, token) }]]);
    const payload = { bot_username: "MonitorTestBot", chats: [{ id: "-1001234567890", name: "Operations", type: "supergroup" }] };
    discover.mockResolvedValue(payload);
    const response = await request(app()).get("/telegram/chats").set("x-test-role", "admin");
    expect(response.status).toBe(200); expect(response.body).toEqual(payload);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(discover).toHaveBeenCalledWith(token); expect(response.text).not.toContain(token);
    expect(transaction).not.toHaveBeenCalled(); expect(execute.mock.calls[0][0].trim()).toMatch(/^SELECT/);
  });
  it("rejects missing configuration and unknown query fields", async () => {
    execute.mockResolvedValue([[]]);
    expect((await request(app()).get("/telegram/chats").set("x-test-role", "admin")).status).toBe(409);
    expect((await request(app()).get("/telegram/chats?bot_token=not-accepted").set("x-test-role", "admin")).status).toBe(422);
    expect(discover).not.toHaveBeenCalled();
  });
});
