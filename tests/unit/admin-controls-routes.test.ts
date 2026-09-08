import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config.js";
const state = vi.hoisted(() => ({ execute: vi.fn(), role: "admin", verify: vi.fn(), hash: vi.fn() }));
vi.mock("../../src/server/db.js", () => ({ getPool: () => ({ execute: state.execute, query: state.execute }),
  withTransaction: async (_config: unknown, operation: (connection: unknown) => Promise<unknown>) => operation({ execute: state.execute }) }));
vi.mock("../../src/server/security/crypto.js", async (original) => ({
  ...await original<typeof import("../../src/server/security/crypto.js")>(), verifyPassword: state.verify, hashPassword: state.hash
}));
vi.mock("../../src/server/middleware/auth.js", async (original) => ({
  ...await original<typeof import("../../src/server/middleware/auth.js")>(),
  authenticate: () => (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { user: { id: "actor", email: "actor@example.test", role: state.role }, userInternalId: "1", csrfHash: sha256("csrf") } as Request["auth"];
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
  state.role = "admin"; state.execute.mockReset(); state.verify.mockReset(); state.hash.mockReset();
  state.verify.mockResolvedValue(true); state.hash.mockResolvedValue("stored-hash-only");
  state.execute.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT password_hash")) return [[{ password_hash: "acting-hash" }]];
    if (sql.startsWith("SELECT id, public_id FROM projects")) return [[{ id: "11", public_id: first }, { id: "12", public_id: second }]];
    if (sql.startsWith("SELECT a.id, a.project_id")) return [[{ id: "31", project_id: "11" }]];
    return [{ affectedRows: 2 }];
  });
});
describe("admin controls", () => {
  it("creates only a full-access admin with a hashed password and safe audit", async () => {
    const result = await request(app()).post("/admins").set("x-csrf-token", "csrf").send({
      email: "NEW@EXAMPLE.TEST", password: "synthetic new password", current_password: "synthetic current password"
    });
    expect(result.status).toBe(201);
    const insert = state.execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO internal_users"))!;
    expect(insert[0]).toContain("'admin'"); expect(insert[1]).toContain("new@example.test"); expect(insert[1]).toContain("stored-hash-only");
    expect(JSON.stringify(state.execute.mock.calls)).not.toContain("synthetic new password");
    expect(JSON.stringify(result.body)).not.toContain("password");
  });
  it("rejects incorrect current password without creating an account", async () => {
    state.verify.mockResolvedValue(false);
    const result = await request(app()).post("/admins").set("x-csrf-token", "csrf").send({email:"new@example.test",password:"synthetic new password",current_password:"wrong"});
    expect(result.status).toBe(400); expect(state.hash).not.toHaveBeenCalled();
  });
  it("rejects a duplicate email with a controlled conflict", async () => {
    state.execute.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT password_hash")) return [[{ password_hash: "hash" }]];
      throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
    });
    const result = await request(app()).post("/admins").set("x-csrf-token", "csrf").send({email:"new@example.test",password:"synthetic new password",current_password:"current"});
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
