import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config";
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../src/server/db.js", () => ({ getPool: () => ({ execute }), withTransaction: async (_config: unknown, operation: (connection: unknown) => Promise<unknown>) => operation({ execute }) }));
vi.mock("../../src/server/middleware/csrf.js", () => ({ requireCsrf: (_request: Request, _response: Response, next: NextFunction) => next() }));
vi.mock("../../src/server/middleware/auth.js", async original => ({ ...await original<typeof import("../../src/server/middleware/auth.js")>(),
  authenticate: () => (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userInternalId: "1", user: { role: "sub_admin", permissions: ["view_projects", ...(req.get("x-permission") ? [req.get("x-permission")] : [])] } } as unknown as Request["auth"]; next();
  }
}));
import { createMaintenanceRouter } from "../../src/server/routes/maintenance";
import { errorHandler } from "../../src/server/errors";
const project = "00000000-0000-4000-8000-000000000001", agent = "00000000-0000-4000-8000-000000000002";
const base = `/${project}/maintenance`, agentBase = `/${project}/agents/${agent}/maintenance`;
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
