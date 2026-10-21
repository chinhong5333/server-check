import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config";
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../src/server/db.js", () => ({ getPool: () => ({ execute }), withTransaction: async (_config: unknown, operation: (connection: unknown) => Promise<unknown>) => operation({ execute }) }));
vi.mock("../../src/server/middleware/csrf.js", () => ({ requireCsrf: (_request: Request, _response: Response, next: NextFunction) => next() }));
vi.mock("../../src/server/middleware/auth.js", async original => ({ ...await original<typeof import("../../src/server/middleware/auth.js")>(),
  authenticate: () => (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userInternalId: "1", user: { role: req.get("x-role") ?? "sub_admin", permissions: ["view_projects", ...(req.get("x-permission") ? [req.get("x-permission")] : [])] } } as unknown as Request["auth"]; next();
  }
}));
import { createAllProjectsMaintenanceRouter, createMaintenanceRouter } from "../../src/server/routes/maintenance";
import { errorHandler } from "../../src/server/errors";
const project = "00000000-0000-4000-8000-000000000001", agent = "00000000-0000-4000-8000-000000000002";
const base = `/${project}/maintenance`, agentBase = `/${project}/agents/${agent}/maintenance`;
function allApp() { const app = express(); app.use(express.json(), createAllProjectsMaintenanceRouter({} as AppConfig), errorHandler); return app; }
function app() { const app = express(); app.use(express.json(), createMaintenanceRouter({} as AppConfig), errorHandler); return app; }
beforeEach(() => { execute.mockReset(); });

it("enforces project and agent management permissions independently", async () => {
  expect((await request(app()).post(base).set("x-permission", "edit_agent_settings").send({})).status).toBe(403);
  expect((await request(app()).post(agentBase).set("x-permission", "edit_project_settings").send({})).status).toBe(403);
  expect(execute).not.toHaveBeenCalled();
});

it("validates canonical schedule input and does not mute before a scheduled start", async () => {
  let window: Record<string, unknown> | null = null;
  execute.mockImplementation(async (sql: string, values: unknown[]) => {
    if (sql.startsWith("SELECT id FROM projects")) return [[{ id: "1" }]];
    if (sql.startsWith("SELECT id, public_id, server_name FROM agents")) return [[{ id: "2", public_id: agent, server_name: "Synthetic" }]];
    if (sql.startsWith("SELECT id FROM maintenance_windows")) return [[]];
    if (sql.startsWith("SELECT * FROM maintenance_windows")) return [window ? [window] : []];
    if (sql.includes("INSERT INTO maintenance_windows")) window = { public_id: values[0], agent_id: null, starts_at: values[3], ends_at: values[4], reason: values[5] };
    return [{ affectedRows: 1 }];
  });
  const now = Date.now(), body = { starts_at: now + 60000, ends_at: now + 3600000, reason: "Synthetic update" };
  expect((await request(app()).post(base).set("x-permission", "edit_project_settings").send({ ...body, startAt: now })).status).toBe(422);
  expect((await request(app()).post(base).set("x-permission", "edit_project_settings").send({ ...body, ends_at: now - 1 })).status).toBe(422);
  const response = await request(app()).post(base).set("x-permission", "edit_project_settings").send(body);
  expect(response.status).toBe(201);
  expect(response.body.own).toMatchObject({ status: "scheduled", starts_at: body.starts_at, ends_at: body.ends_at });
  expect(execute.mock.calls.some(([sql]) => sql.includes("Suppressed during maintenance"))).toBe(false);
});

const otherProject = "00000000-0000-4000-8000-000000000003", batch = "00000000-0000-4000-8000-0000000000b1";

it("allows only admins to start or end all-projects maintenance", async () => {
  const now = Date.now(), body = { starts_at: null, ends_at: now + 3600000, reason: "Synthetic platform update" };
  expect((await request(allApp()).post("/").set("x-permission", "edit_project_settings").send(body)).status).toBe(403);
  expect((await request(allApp()).delete(`/${batch}`).set("x-permission", "edit_project_settings")).status).toBe(403);
  expect(execute).not.toHaveBeenCalled();
});

it("puts every project without its own window into one batch and mutes it immediately", async () => {
  const inserts: unknown[][] = [];
  execute.mockImplementation(async (sql: string, values: unknown[]) => {
    if (sql.startsWith("SELECT w.batch_id")) return [inserts.length ? [{ batch_id: inserts[0][10], starts_at: inserts[0][3], ends_at: inserts[0][4], reason: inserts[0][5] }] : []];
    if (sql.startsWith("SELECT public_id FROM projects")) return [[{ public_id: project }, { public_id: otherProject }]];
    if (sql.startsWith("SELECT id FROM projects")) return [[{ id: values[0] === project ? "1" : "2" }]];
    if (sql.startsWith("SELECT id, public_id, server_name FROM agents")) return [[{ id: values[0] === "1" ? "11" : "22", public_id: agent, server_name: "Synthetic" }]];
    if (sql.startsWith("SELECT id FROM maintenance_windows")) return [values[0] === "2" ? [{ id: "5" }] : []];
    if (sql.includes("INSERT INTO maintenance_windows")) inserts.push(values);
    return [{ affectedRows: 1 }];
  });
  const now = Date.now();
  const response = await request(allApp()).post("/").set("x-role", "admin").send({ starts_at: null, ends_at: now + 3600000, reason: "Synthetic platform update" });
  expect(response.status).toBe(201);
  expect(inserts).toHaveLength(1);
  expect(inserts[0][1]).toBe("1");
  expect(response.body.own).toMatchObject({ id: inserts[0][10], scope: "project", status: "active", reason: "Synthetic platform update" });
  const muted = execute.mock.calls.filter(([sql]) => String(sql).includes("Suppressed during maintenance")).map(([, values]) => values[1]);
  expect(muted).toEqual(["11"]);
});

it("ends every open window in an all-projects batch and rejects an unknown batch", async () => {
  execute.mockImplementation(async (sql: string) => sql.startsWith("SELECT DISTINCT p.id") ? [[]] : [{ affectedRows: 1 }]);
  expect((await request(allApp()).delete(`/${batch}`).set("x-role", "admin")).status).toBe(404);
  const now = Date.now();
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT DISTINCT p.id")) return [[{ id: "1", public_id: project }]];
    if (sql.startsWith("SELECT id FROM projects")) return [[{ id: "1" }]];
    if (sql.startsWith("SELECT id, public_id, server_name FROM agents")) return [[{ id: "11", public_id: agent, server_name: "Synthetic" }]];
    if (sql.startsWith("SELECT id, public_id, starts_at, ended_at FROM maintenance_windows")) return [[
      { id: "7", public_id: "w-open", starts_at: now - 60000, ended_at: null },
      { id: "8", public_id: "w-ended", starts_at: now - 60000, ended_at: now - 1000 }]];
    return [{ affectedRows: 1 }];
  });
  expect((await request(allApp()).delete(`/${batch}`).set("x-role", "admin")).status).toBe(204);
  const ended = execute.mock.calls.filter(([sql]) => String(sql).startsWith("UPDATE maintenance_windows SET ended_at")).map(([, values]) => values[2]);
  expect(ended).toEqual(["7"]);
  expect(execute.mock.calls.some(([sql, values]) => String(sql).includes("'maintenance.end'") && String(values[3]).includes(batch))).toBe(true);
});
