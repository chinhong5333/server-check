import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config.js";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/server/db.js", () => ({ getPool: () => ({ query }), withTransaction: vi.fn() }));
vi.mock("../../src/server/middleware/auth.js", () => ({
  authenticate: () => (_request: Request, _response: Response, next: NextFunction) => next(),
  requirePermission: () => (_request: Request, _response: Response, next: NextFunction) => next()
}));
import { createProjectsRouter } from "../../src/server/routes/projects.js";
import { errorHandler } from "../../src/server/errors.js";

function app() {
  const server = express();
  server.use(createProjectsRouter({} as AppConfig), errorHandler);
  return server;
}

beforeEach(() => query.mockReset());

describe("Project list agent previews", () => {
  it("returns six bounded previews for active projects and an empty array for projects without agents", async () => {
    query.mockResolvedValueOnce([[{
      id: "1", public_id: "project-1", name: "Coincat", slug: "coincat",
      healthy_agents: "3", new_agents: "1", warning_agents: "1", critical_agents: "1", stale_agents: "0"
    }, {
      id: "2", public_id: "project-2", name: "Empty", slug: "empty",
      healthy_agents: "0", new_agents: "0", warning_agents: "0", critical_agents: "0", stale_agents: "0"
    }]]).mockResolvedValueOnce([[...Array.from({ length: 6 }, (_, index) => ({
      project_id: "1", public_id: `agent-${index + 1}`, server_name: `agent-${index + 1}`,
      status: (["critical", "warning", "new", "healthy", "healthy", "healthy"] as const)[index]
    }))]]);
    const response = await request(app()).get("/");
    expect(response.status).toBe(200);
    expect(response.body[0].agents_preview).toHaveLength(6);
    expect(response.body[0].agents_preview[0]).toEqual({ id: "agent-1", server_name: "agent-1", status: "critical" });
    expect(response.body[1].agents_preview).toEqual([]);
    expect(query.mock.calls[1][0]).toContain("ROW_NUMBER() OVER");
    expect(query.mock.calls[1][0]).toContain("preview_rank <= 6");
    expect(query.mock.calls[1][0]).toContain("a.created_at DESC");
  });

  it("skips the preview query when there are no active projects", async () => {
    query.mockResolvedValueOnce([[]]);
    const response = await request(app()).get("/");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
