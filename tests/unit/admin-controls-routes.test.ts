import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config.js";
const state = vi.hoisted(() => ({ execute: vi.fn(), role: "admin", permissions: [] as string[], verify: vi.fn(), hash: vi.fn() }));
vi.mock("../../src/server/db.js", () => ({ getPool: () => ({ execute: state.execute, query: state.execute }),
  withTransaction: async (_config: unknown, operation: (connection: unknown) => Promise<unknown>) => operation({ execute: state.execute }) }));
vi.mock("../../src/server/security/crypto.js", async (original) => ({
  ...await original<typeof import("../../src/server/security/crypto.js")>(), verifyPassword: state.verify, hashPassword: state.hash
}));
vi.mock("../../src/server/middleware/auth.js", async (original) => ({
  ...await original<typeof import("../../src/server/middleware/auth.js")>(),
  authenticate: () => (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { user: { id: "actor", email: "actor@example.test", role: state.role, permissions: state.permissions }, userInternalId: "1", csrfHash: sha256("csrf") } as Request["auth"];
    next();
  }
}));
import { sha256 } from "../../src/server/security/crypto.js";
import { createAdminsRouter } from "../../src/server/routes/admins.js";
import { createProjectsRouter } from "../../src/server/routes/projects.js";
import { createAgentsRouter } from "../../src/server/routes/agents.js";
import { errorHandler } from "../../src/server/errors.js";
const config = {} as AppConfig;
const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
function app() {
  const result = express(); result.use(express.json());
  result.use("/admins", createAdminsRouter(config)); result.use("/projects", createProjectsRouter(config));
  result.use("/agents", createAgentsRouter(config)); result.use(errorHandler); return result;
}
beforeEach(() => {
  state.role = "admin"; state.permissions = []; state.execute.mockReset(); state.verify.mockReset(); state.hash.mockReset();
  state.verify.mockResolvedValue(true); state.hash.mockResolvedValue("stored-hash-only");
  state.execute.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT password_hash")) return [[{ password_hash: "acting-hash" }]];
    if (sql.startsWith("SELECT id, public_id FROM projects")) return [[{ id: "11", public_id: first }, { id: "12", public_id: second }]];
    if (sql.startsWith("SELECT a.id, a.project_id")) return [[{ id: "31", project_id: "11" }]];
    if (sql.includes("FROM agents") && sql.includes("FOR UPDATE")) return [[{ id: "31" }]];
    return [{ affectedRows: 2 }];
  });
});
describe("admin controls", () => {
  it.each([true,false])("sets sub-admin enabled=%s and revokes sessions only on disable", async enabled => {
    state.execute.mockImplementation(async (sql:string) => {
      if(sql.startsWith("SELECT id FROM internal_users")) return [[{id:"1"}]];
      if(sql.startsWith("SELECT id, is_disabled")) return [[{id:"20",is_disabled:0}]];
      return [{affectedRows:1}];
    });
    const result=await request(app()).patch(`/admins/${second}/status`).set("x-csrf-token","csrf").send({enabled});
    expect(result.status).toBe(204);
    expect(state.execute).toHaveBeenCalledWith("UPDATE internal_users SET is_disabled = ?, updated_at = ? WHERE id = ?",[enabled?0:1,expect.any(Number),"20"]);
    expect(state.execute.mock.calls.some(([sql])=>sql.startsWith("UPDATE user_sessions"))).toBe(!enabled);
  });
  it("rejects status changes by sub-admins, invalid input, and full-admin targets", async () => {
    state.role="sub_admin";state.permissions=["view_projects","edit_global_settings"];
    expect((await request(app()).patch(`/admins/${second}/status`).set("x-csrf-token","csrf").send({enabled:false})).status).toBe(403);
    expect(state.execute).not.toHaveBeenCalled();
    state.role="admin";
    expect((await request(app()).patch(`/admins/${second}/status`).set("x-csrf-token","csrf").send({enabled:"false"})).status).toBe(422);
    state.execute.mockImplementation(async(sql:string)=>sql.startsWith("SELECT id FROM internal_users")?[[{id:"1"}]]:[[]]);
    expect((await request(app()).patch(`/admins/${second}/status`).set("x-csrf-token","csrf").send({enabled:false})).status).toBe(404);
    expect(state.execute.mock.calls.some(([sql])=>sql.startsWith("UPDATE"))).toBe(false);
  });
  it("creates sub-admins with only the explicit permissions", async () => {
    const result = await request(app()).post("/admins").set("x-csrf-token","csrf").send({email:"sub@example.test",password:"SyntheticNew1!",current_password:"current",role:"sub_admin",permissions:["view_projects","edit_agent_settings"]});
    expect(result.status).toBe(201);
    const values = state.execute.mock.calls.find(([sql])=>sql.includes("INSERT INTO internal_users"))![1];
    expect(values).toContain("sub_admin");
    expect(values).toContain('["view_projects","edit_agent_settings"]');
  });
  it("never lets sub-admins access Teams even with every capability", async () => {
    state.role="sub_admin"; state.permissions=["view_projects","edit_global_settings","edit_project_settings","edit_agent_settings","delete_projects","delete_agents","rotate_agent_secrets"];
    expect((await request(app()).get("/admins")).status).toBe(403);
    expect((await request(app()).post("/admins").set("x-csrf-token","csrf").send({})).status).toBe(403);
    expect((await request(app()).patch(`/admins/${first}/permissions`).set("x-csrf-token","csrf").send({})).status).toBe(403);
    expect(state.execute).not.toHaveBeenCalled();
  });
  it.each([
    ["delete", `/projects/${first}`], ["delete", `/projects/${first}/agents/${second}`],
    ["post", `/projects/${first}/agents/${second}/credential-rotation`]
  ])("edit permissions cannot authorize %s %s", async (method,path) => {
    state.role="sub_admin"; state.permissions=["view_projects","edit_project_settings","edit_agent_settings"];
    const call = method === "delete" ? request(app()).delete(path) : request(app()).post(path);
    expect((await call.set("x-csrf-token","csrf").send({})).status).toBe(403);
    expect(state.execute).not.toHaveBeenCalled();
  });
  it("denies project reads without view permission", async () => {
    state.role="sub_admin"; state.permissions=["edit_global_settings"];
    expect((await request(app()).get("/projects")).status).toBe(403);
    expect((await request(app()).get(`/agents/${first}/history`)).status).toBe(403);
    expect(state.execute).not.toHaveBeenCalled();
  });
  it("updates only sub-admin permissions after checking the acting admin", async () => {
    const original = state.execute.getMockImplementation()!;
    state.execute.mockImplementation((sql:string,...args:unknown[])=>sql.startsWith("SELECT id FROM internal_users") ? Promise.resolve([[{id:"20"}]]) : original(sql,...args));
    const result = await request(app()).patch(`/admins/${second}/permissions`).set("x-csrf-token","csrf").send({current_password:"current",permissions:["view_projects"]});
    expect(result.status).toBe(204);
    expect(state.execute).toHaveBeenCalledWith("UPDATE internal_users SET permissions_json = ?, updated_at = ? WHERE id = ?", ['["view_projects"]',expect.any(Number),"20"]);
  });
  it("creates only a full-access admin with a hashed password and safe audit", async () => {
    const result = await request(app()).post("/admins").set("x-csrf-token", "csrf").send({
      email: "NEW@EXAMPLE.TEST", password: "SyntheticNew1!", current_password: "synthetic current password"
    });
    expect(result.status).toBe(201);
    const insert = state.execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO internal_users"))!;
    expect(insert[1]).toContain("admin"); expect(insert[1]).toContain("new@example.test"); expect(insert[1]).toContain("stored-hash-only");
    expect(JSON.stringify(state.execute.mock.calls)).not.toContain("SyntheticNew1!");
    expect(JSON.stringify(result.body)).not.toContain("password");
  });
  it("rejects incorrect current password without creating an account", async () => {
    state.verify.mockResolvedValue(false);
    const result = await request(app()).post("/admins").set("x-csrf-token", "csrf").send({email:"new@example.test",password:"SyntheticNew1!",current_password:"wrong"});
    expect(result.status).toBe(400); expect(state.hash).not.toHaveBeenCalled();
  });
  it("rejects a duplicate email with a controlled conflict", async () => {
    state.execute.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT password_hash")) return [[{ password_hash: "hash" }]];
      throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
    });
    const result = await request(app()).post("/admins").set("x-csrf-token", "csrf").send({email:"new@example.test",password:"SyntheticNew1!",current_password:"current"});
    expect(result.status).toBe(409);
  });
  it("saves a complete reordered snapshot and rejects stale snapshots", async () => {
    const result = await request(app()).put("/projects/order").set("x-csrf-token", "csrf").send({expected_ids:[first,second],ordered_ids:[second,first]});
    expect(result.status).toBe(204);
    expect(state.execute).toHaveBeenCalledWith("UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ?", [1,expect.any(Number),"12"]);
    const stale = await request(app()).put("/projects/order").set("x-csrf-token", "csrf").send({expected_ids:[second,first],ordered_ids:[first,second]});
    expect(stale.status).toBe(409);
  });
  it("rejects duplicate order IDs without writing", async () => {
    const result = await request(app()).put("/projects/order").set("x-csrf-token", "csrf").send({expected_ids:[first,second],ordered_ids:[first,first]});
    expect(result.status).toBe(422); expect(state.execute).not.toHaveBeenCalled();
  });
  it("cancels only pending Telegram rows for the selected agent and audits the count", async () => {
    const result = await request(app()).post(`/agents/${first}/telegram-deliveries/cancel-pending`).set("x-csrf-token", "csrf").send({confirm:true});
    expect(result.status).toBe(200); expect(result.body).toEqual({cancelled_count:2});
    const update = state.execute.mock.calls.find(([sql]) => sql.includes("UPDATE notification_outbox"))!;
    expect(update[0]).toContain("i.agent_id = ?"); expect(update[0]).toContain("o.status = 'pending'");
    expect(update[0]).toContain("o.channel = 'telegram'"); expect(update[1][1]).toBe("31");
    expect(update[0]).not.toContain("DELETE");
  });
  it("requires explicit cancellation confirmation", async () => {
    const result = await request(app()).post(`/agents/${first}/telegram-deliveries/cancel-pending`).set("x-csrf-token", "csrf").send({});
    expect(result.status).toBe(422); expect(state.execute).not.toHaveBeenCalled();
  });
  it.each(["/admins", `/agents/${first}/telegram-deliveries/cancel-pending`, "/projects/order"])("rejects non-admin and missing CSRF at %s", async (path) => {
    const send = () => path === "/projects/order" ? request(app()).put(path) : request(app()).post(path);
    state.role = "operator";
    expect((await send().set("x-csrf-token","csrf").send({})).status).toBe(403);
    state.role = "admin";
    expect((await send().send({})).status).toBe(403);
    expect(state.execute).not.toHaveBeenCalled();
  });
});
