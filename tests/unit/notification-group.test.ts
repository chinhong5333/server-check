import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import { telegramGroupUrlSchema } from "../../src/shared/contracts";
import type { AppConfig } from "../../src/server/config";

const state = vi.hoisted(() => ({ url: null as string | null, enabled: 0 }));
vi.mock("../../src/server/db.js", () => ({
  getPool: () => ({ execute: async () => [[{
    id: "1", telegram_bot_token_encrypted: null, telegram_chat_id: null,
    telegram_group_url: state.url, telegram_group_enabled: state.enabled, is_delete: 0
  }]] }),
  withTransaction: async (_config: unknown, operation: (connection: { execute: (sql: string, params: unknown[]) => Promise<unknown> }) => Promise<unknown>) => operation({
    execute: async (sql, params) => {
      if (sql.includes("SELECT telegram_group_url")) return [[{ telegram_group_url: state.url }]];
      if (sql.includes("SELECT id, telegram_bot_token_encrypted")) return [[{
        id: "1", telegram_bot_token_encrypted: null, telegram_chat_id: null,
        telegram_group_url: state.url, telegram_group_enabled: state.enabled, is_delete: 0
      }]];
      if (sql.includes("UPDATE platform_telegram_settings")) {
        state.url = params[2] as string | null;
        state.enabled = params[3] as number;
      }
      if (sql.includes("INSERT INTO platform_telegram_settings")) state.enabled = params[1] as number;
      return [[], []];
    }
  })
}));
vi.mock("../../src/server/middleware/csrf.js", () => ({ requireCsrf: (_req: Request, _res: Response, next: NextFunction) => next() }));
vi.mock("../../src/server/middleware/auth.js", async original => ({
  ...await original<typeof import("../../src/server/middleware/auth.js")>(),
  authenticate: () => (req: Request, res: Response, next: NextFunction) => {
    if (!req.get("x-test-user")) { res.sendStatus(401); return; }
    req.auth = { userInternalId: "1", user: { id: "test", role: "sub_admin", permissions: req.get("x-test-user") === "manager" ? ["edit_global_settings"] : [] } } as unknown as Request["auth"];
    next();
  }
}));
import { createSettingsRouter } from "../../src/server/routes/settings";
import { errorHandler } from "../../src/server/errors";
function app() { const app = express(); app.use(express.json(), createSettingsRouter({ jwt: { secret: "synthetic" } } as AppConfig), errorHandler); return app; }
beforeEach(() => { state.url = null; state.enabled = 0; });

it("accepts only safe Telegram group and invite links", () => {
  for (const url of ["https://t.me/group_name", "https://t.me/+invite_token", "https://t.me/joinchat/invite_token"]) expect(telegramGroupUrlSchema.safeParse(url).success).toBe(true);
  for (const url of ["javascript:alert(1)", "http://t.me/group", "https://t.me.evil.test/group", "https://user@t.me/group", "https://t.me/", "https://t.me/group?redirect=evil"]) expect(telegramGroupUrlSchema.safeParse(url).success).toBe(false);
});
it("exposes the saved URL only when enabled, while managers can read configuration", async () => {
  state.url = "https://t.me/+groupinvite";
  expect((await request(app()).get("/telegram/group-link")).status).toBe(401);
  const hidden = await request(app()).get("/telegram/group-link").set("x-test-user", "sub");
  expect(hidden.body).toEqual({ telegram_group_url: null, telegram_group_enabled: false });
  const manager = await request(app()).get("/telegram").set("x-test-user", "manager");
  expect(manager.body.telegram_group_url).toBe(state.url);
  state.enabled = 1;
  const shown = await request(app()).get("/telegram/group-link").set("x-test-user", "sub");
  expect(shown.body).toEqual({ telegram_group_url: state.url, telegram_group_enabled: true });
  expect(shown.headers["cache-control"]).toBe("no-store");
});
it("denies group-link changes to team members without global-settings permission", async () => {
  expect((await request(app()).patch("/telegram/group-link").set("x-test-user", "sub").send({ telegram_group_enabled: true })).status).toBe(403);
  expect((await request(app()).patch("/telegram").set("x-test-user", "sub").send({ telegram_chat_id: null, telegram_group_url: "https://t.me/group_name" })).status).toBe(403);
  expect((await request(app()).get("/telegram").set("x-test-user", "sub")).status).toBe(403);
});
it("saves a manual link, enables the bar, and clears both link and visibility", async () => {
  const server = app();
  expect((await request(server).patch("/telegram").set("x-test-user", "manager").send({ telegram_chat_id: null, telegram_group_url: "https://t.me/+groupinvite" })).status).toBe(204);
  expect(state.url).toBe("https://t.me/+groupinvite");
  expect(state.enabled).toBe(0);
  expect((await request(server).patch("/telegram/group-link").set("x-test-user", "manager").send({ telegram_group_enabled: true })).status).toBe(204);
  expect(state.enabled).toBe(1);
  expect((await request(server).patch("/telegram").set("x-test-user", "manager").send({ telegram_chat_id: null, telegram_group_url: null })).status).toBe(204);
  expect(state.url).toBeNull();
  expect(state.enabled).toBe(0);
});
it("rejects unsafe URLs at the API boundary", async () => {
  const response = await request(app()).patch("/telegram").set("x-test-user", "manager").send({ telegram_chat_id: null, telegram_group_url: "https://evil.test/phishing" });
  expect(response.status).toBe(422);
  expect(state.url).toBeNull();
});
it("cannot enable a notification bar without a saved link", async () => {
  const response = await request(app()).patch("/telegram/group-link").set("x-test-user", "manager").send({ telegram_group_enabled: true });
  expect(response.status).toBe(409);
  expect(state.enabled).toBe(0);
});
