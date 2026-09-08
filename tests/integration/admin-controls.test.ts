import { randomUUID } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { assertSafeTestDatabase, loadConfig, type AppConfig } from "../../src/server/config.js";
import { closePool, getPool } from "../../src/server/db.js";
import { runMigrations } from "../../src/server/migrations.js";
import { hashPassword, sha256, verifyPassword } from "../../src/server/security/crypto.js";
let actorId: string;
vi.mock("../../src/server/middleware/auth.js", async (original) => ({
  ...await original<typeof import("../../src/server/middleware/auth.js")>(),
  authenticate: () => (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { user: { id: "synthetic-actor", email: "actor@example.test", role: "admin" },
      userInternalId: actorId, csrfHash: sha256("synthetic-csrf") } as Request["auth"];
    next();
  }
}));
import { createAdminsRouter } from "../../src/server/routes/admins.js";
import { createProjectsRouter } from "../../src/server/routes/projects.js";
import { createAgentsRouter } from "../../src/server/routes/agents.js";
import { errorHandler } from "../../src/server/errors.js";
let config: AppConfig;
let app: express.Express;
const projectIds: number[] = [];
const userIds: number[] = [];
const publicIds = [randomUUID(), randomUUID()];
const stamp = { created_at: Date.now(), updated_at: Date.now(), is_delete: 0 };
async function insert(table: string, values: Record<string, unknown>) {
  const keys = Object.keys(values);
  const [result] = await getPool(config).execute<ResultSetHeader>(
    `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, Object.values(values));
  return result.insertId;
}
beforeAll(async () => {
  config = loadConfig(); assertSafeTestDatabase(config);
  const [version] = await getPool(config).query<RowDataPacket[]>("SELECT VERSION() AS version");
  if (/mariadb/i.test(version[0].version) || Number.parseInt(version[0].version) < 8) throw new Error("Requires local MySQL 8+");
  await runMigrations(config);
  const [existing] = await getPool(config).query<RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM projects) + (SELECT COUNT(*) FROM internal_users) AS total");
  if (Number(existing[0].total) !== 0) throw new Error("Admin integration requires an empty dedicated test schema; existing records will not be altered");
  actorId = String(await insert("internal_users", { public_id: randomUUID(), email: `actor-${randomUUID()}@example.test`,
    password_hash: await hashPassword("synthetic acting password"), role: "admin", ...stamp }));
  userIds.push(Number(actorId));
  for (const [index, publicId] of publicIds.entries()) projectIds.push(await insert("projects", {
    public_id: publicId, name: `Synthetic ${index}`, slug: publicId, ram_available_threshold_percent: 15,
    disk_available_threshold_percent: 10, load_5_per_core_threshold: 1.5, heartbeat_interval_seconds: 60,
    heartbeat_grace_seconds: 0, ...stamp
  }));
  app = express(); app.use(express.json());
  app.use("/admins", createAdminsRouter(config)); app.use("/projects", createProjectsRouter(config)); app.use("/agents", createAgentsRouter(config)); app.use(errorHandler);
});
afterAll(async () => {
  if (config) {
    for (const id of projectIds) {
      for (const table of ["notification_outbox", "incidents", "audit_events", "agents"]) await getPool(config).execute(`DELETE FROM ${table} WHERE project_id = ?`, [id]);
      await getPool(config).execute("DELETE FROM projects WHERE id = ?", [id]);
    }
    for (const id of userIds) {
      await getPool(config).execute("DELETE FROM audit_events WHERE user_id = ?", [id]);
      await getPool(config).execute("DELETE FROM internal_users WHERE id = ?", [id]);
    }
    await closePool();
  }
});
it("persists the global order and creates a usable full-access password hash", async () => {
  const sorted = await request(app).put("/projects/order").set("x-csrf-token", "synthetic-csrf")
    .send({ expected_ids: publicIds, ordered_ids: [...publicIds].reverse() });
  expect(sorted.status).toBe(204);
  expect((await request(app).get("/projects")).body.map((p: {id: string}) => p.id)).toEqual([...publicIds].reverse());
  const email = `created-${randomUUID()}@example.test`;
  const created = await request(app).post("/admins").set("x-csrf-token", "synthetic-csrf")
    .send({email, password:"synthetic new admin password", current_password:"synthetic acting password"});
  const [rows] = await getPool(config).execute<RowDataPacket[]>("SELECT id, password_hash, role FROM internal_users WHERE email = ?", [email]);
  if (rows[0]) userIds.push(Number(rows[0].id));
  expect(created.status).toBe(201); expect(rows[0].role).toBe("admin");
  expect(await verifyPassword("synthetic new admin password", rows[0].password_hash)).toBe(true);
});
it("cancels the chosen agent queue without deleting sent messages or another agent's queue", async () => {
  const agents: number[] = []; const agentPublicIds = [randomUUID(), randomUUID()];
  for (const id of agentPublicIds) agents.push(await insert("agents", { public_id:id, project_id:projectIds[0], server_name:id,
    health_api_url:null, health_request_timeout_seconds:5, apache_service_name:"apache2", credential_hash:"0".repeat(64), credential_hint:"synthetic",
    ram_available_threshold_percent:15, disk_available_threshold_percent:10, load_5_per_core_threshold:1.5, heartbeat_interval_seconds:60, ...stamp }));
  const deliveries: number[] = [];
  for (const [index, agentId] of agents.entries()) {
    const incidentId = await insert("incidents", { public_id:randomUUID(), project_id:projectIds[0], agent_id:agentId,
      incident_type:"heartbeat_missed", severity:"critical", status:"open", probable_cause:"synthetic", details_json:"{}", opened_at:stamp.created_at, ...stamp });
    for (const status of index === 0 ? ["pending", "sent"] : ["pending"]) deliveries.push(await insert("notification_outbox", {
      project_id:projectIds[0], incident_id:incidentId, channel:"telegram", event_type:"opened", payload_json:"{}", status,
      attempt_count:0, next_attempt_at:stamp.created_at, ...stamp }));
  }
  const result = await request(app).post(`/agents/${agentPublicIds[0]}/telegram-deliveries/cancel-pending`).set("x-csrf-token", "synthetic-csrf").send({confirm:true});
  expect(result.status).toBe(200); expect(result.body.cancelled_count).toBe(1);
  const states = [];
  for (const id of deliveries) {
    const [rows] = await getPool(config).execute<RowDataPacket[]>("SELECT status FROM notification_outbox WHERE id = ?", [id]);
    states.push(rows[0].status);
  }
  expect(states).toEqual(["cancelled", "sent", "pending"]);
});
