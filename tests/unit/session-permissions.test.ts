import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config";
const state = vi.hoisted(() => ({ permissions: '["view_projects","delete_agents"]' }));
vi.mock("../../src/server/db", () => ({ getPool: () => ({ execute: async () => [[{
  session_internal_id:"1",session_public_id:"session",user_internal_id:"2",user_public_id:"user",email:"sub@example.test",
  role:"sub_admin",permissions_json:state.permissions,csrf_hash:"unused",expires_at:Date.now()+3600000,revoked_at:null,last_seen_at:Date.now()
}]] }) }));
import { authenticate, requirePermission, requireRole } from "../../src/server/middleware/auth";
import { issueSessionJwt, sessionCookieName } from "../../src/server/security/jwt";
import { errorHandler } from "../../src/server/errors";
const config = { nodeEnv:"test", jwt:{secret:"a".repeat(48),issuer:"test",audience:"test",ttlSeconds:900} } as AppConfig;
beforeEach(() => { state.permissions='["view_projects","delete_agents"]';});
it("uses current persisted role and grants instead of stale JWT authority", async () => {
  const app = express(); app.use(authenticate(config));
  app.get("/delete",requirePermission("delete_agents"),(_req,res)=>res.sendStatus(200));
  app.get("/teams",requireRole("admin"),(_req,res)=>res.sendStatus(200));
  app.use(errorHandler);
  const token = await issueSessionJwt(config,{sub:"user",sid:"session",role:"admin"});
  const cookie = `${sessionCookieName(config)}=${token}`;
  expect((await request(app).get("/delete").set("Cookie",cookie)).status).toBe(200);
  expect((await request(app).get("/teams").set("Cookie",cookie)).status).toBe(403);
  state.permissions='["view_projects"]';
  expect((await request(app).get("/delete").set("Cookie",cookie)).status).toBe(403);
  state.permissions='invalid';
  expect((await request(app).get("/delete").set("Cookie",cookie)).status).toBe(403);
});
