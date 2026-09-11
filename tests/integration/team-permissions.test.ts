import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, afterAll, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { loadConfig, assertSafeTestDatabase, type AppConfig } from "../../src/server/config.js";
import { getPool, closePool } from "../../src/server/db.js";
import { runMigrations } from "../../src/server/migrations.js";
import { hashPassword } from "../../src/server/security/crypto.js";
import { createApp } from "../../src/server/app.js";

let config: AppConfig; let seeded = false;
const stamp = randomUUID();
const adminEmail = `admin-${stamp}@example.test`, subEmail = `sub-${stamp}@example.test`;
const password = "Synthetic test password 2026!";
beforeAll(async () => {
  config = loadConfig(); assertSafeTestDatabase(config);
  const [version] = await getPool(config).query<RowDataPacket[]>("SELECT VERSION() AS version");
  if (/mariadb/i.test(String(version[0].version)) || parseInt(String(version[0].version)) < 8) throw new Error("Team integration requires dedicated local MySQL 8+");
  await runMigrations(config);
  const now = Date.now();
  await getPool(config).execute("INSERT INTO internal_users (public_id,email,password_hash,role,created_at,updated_at,is_delete) VALUES (?,?,?,'admin',?,?,0)", [randomUUID(),adminEmail,await hashPassword(password),now,now]);
  seeded = true;
});
afterAll(async () => {
  if (seeded) {
    const [rows] = await getPool(config).execute<RowDataPacket[]>("SELECT id FROM internal_users WHERE email IN (?,?)",[adminEmail,subEmail]);
    for (const row of rows) {
      await getPool(config).execute("DELETE FROM user_sessions WHERE user_id = ?",[row.id]);
      await getPool(config).execute("DELETE FROM audit_events WHERE user_id = ?",[row.id]);
    }
    for (const row of rows) await getPool(config).execute("DELETE FROM internal_users WHERE id = ?",[row.id]);
  }
  if (config) await closePool();
});
it("persists sub-admin grants and immediately enforces their revocation on the same session", async () => {
  const {app} = createApp(config);
  const admin = request.agent(app), sub = request.agent(app);
  const login = await admin.post("/api/v1/auth/login").send({email:adminEmail,password,remember_session:false});
  expect(login.status).toBe(200);
  const created = await admin.post("/api/v1/admins").set("x-csrf-token",login.body.csrf_token)
    .send({email:subEmail,password,current_password:password,role:"sub_admin",permissions:["view_projects"]});
  expect(created.status).toBe(201);
  const signedIn = await sub.post("/api/v1/auth/login").send({email:subEmail,password,remember_session:false});
  expect(signedIn.status).toBe(200);
  expect(signedIn.body.user).toMatchObject({role:"sub_admin",permissions:["view_projects"]});
  expect((await sub.get("/api/v1/projects")).status).toBe(200);
  expect((await sub.get("/api/v1/admins")).status).toBe(403);
  expect((await sub.get("/api/v1/settings/telegram")).status).toBe(403);
  expect((await sub.post("/api/v1/projects").set("x-csrf-token",signedIn.body.csrf_token).send({})).status).toBe(403);
  expect((await admin.patch(`/api/v1/admins/${created.body.id}/permissions`).set("x-csrf-token",login.body.csrf_token)
    .send({current_password:password,permissions:[]})).status).toBe(204);
  expect((await sub.get("/api/v1/projects")).status).toBe(403);
  expect((await sub.get("/api/v1/auth/session")).body.user.permissions).toEqual([]);
  expect((await admin.patch(`/api/v1/admins/${created.body.id}/status`).set("x-csrf-token",login.body.csrf_token).send({enabled:false})).status).toBe(204);
  expect((await sub.get("/api/v1/auth/session")).status).toBe(401);
  expect((await sub.post("/api/v1/auth/login").send({email:subEmail,password,remember_session:false})).status).toBe(401);
  expect((await admin.patch(`/api/v1/admins/${created.body.id}/status`).set("x-csrf-token",login.body.csrf_token).send({enabled:true})).status).toBe(204);
  expect((await sub.get("/api/v1/auth/session")).status).toBe(401);
  expect((await sub.post("/api/v1/auth/login").send({email:subEmail,password,remember_session:false})).status).toBe(200);
  expect((await sub.get("/api/v1/projects")).status).toBe(403);
});
