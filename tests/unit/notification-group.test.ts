import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { expect, it, vi } from "vitest";
import { telegramGroupUrlSchema } from "../../src/shared/contracts";
import type { AppConfig } from "../../src/server/config";
const state = vi.hoisted(() => ({ enabled: 1 }));
vi.mock("../../src/server/db.js", () => ({ getPool: () => ({ execute: async () => [[{ telegram_bot_token_encrypted: "synthetic", telegram_group_enabled: state.enabled }]] }) }));
vi.mock("../../src/server/security/telegram-secrets.js", () => ({ decryptPlatformTelegramBotToken: () => "synthetic" }));
vi.mock("../../src/server/services/telegram-chat-discovery.js", () => ({ getTelegramBotLink: async () => ({username:"example_bot",url:"https://t.me/example_bot"}) }));
vi.mock("../../src/server/middleware/auth.js", async original => ({
  ...await original<typeof import("../../src/server/middleware/auth.js")>(),
  authenticate: () => (req: Request, res: Response, next: NextFunction) => {
    if (!req.get("x-test-user")) { res.sendStatus(401); return; }
    req.auth = { user: { id: "test", role: "sub_admin", permissions: req.get("x-test-user") === "manager" ? ["edit_global_settings"] : [] } } as unknown as Request["auth"]; next();
  }
}));
import { createSettingsRouter } from "../../src/server/routes/settings";
import { errorHandler } from "../../src/server/errors";
function app() { const app = express(); app.use(express.json(), createSettingsRouter({ jwt: { secret: "synthetic" } } as AppConfig), errorHandler); return app; }
it("accepts group links and rejects unsafe destinations", () => {
  for (const value of ["https://t.me/group_name", "https://t.me/+invite_token", "https://t.me/joinchat/invite_token"]) expect(telegramGroupUrlSchema.safeParse(value).success).toBe(true);
  for (const value of ["javascript:alert(1)", "http://t.me/group", "https://t.me.evil.test/group", "https://user@t.me/group", "https://t.me/", "https://t.me/group?redirect=evil"]) expect(telegramGroupUrlSchema.safeParse(value).success).toBe(false);
});
it("exposes only the group URL to signed-in sub-admins", async () => {
  expect((await request(app()).get("/telegram/group-link")).status).toBe(401);
  const response = await request(app()).get("/telegram/group-link").set("x-test-user", "sub");
  expect(response.status).toBe(200); expect(response.body).toEqual({ telegram_group_url: "https://t.me/example_bot", telegram_group_enabled: true });
});
it("denies link writes and private Telegram settings without global permission", async () => {
  expect((await request(app()).patch("/telegram/group-link").set("x-test-user", "sub").send({telegram_group_url:null})).status).toBe(403);
  expect((await request(app()).get("/telegram").set("x-test-user", "sub")).status).toBe(403);
});
it("hides the disabled bar for all roles", async () => {
  state.enabled = 0;
  try {
    const member = await request(app()).get("/telegram/group-link").set("x-test-user", "sub");
    expect(member.body).toEqual({ telegram_group_url: null, telegram_group_enabled: false });
    const manager = await request(app()).get("/telegram/group-link").set("x-test-user", "manager");
    expect(manager.body).toEqual({ telegram_group_url: null, telegram_group_enabled: false });
    expect(member.headers["cache-control"]).toBe("no-store");
  } finally { state.enabled = 1; }
});
