import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config.js";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../src/server/db.js", () => ({ getPool: () => ({ execute }) }));
vi.mock("../../src/server/services/maintenance.js", () => ({
  readMaintenanceIndicators: async () => ({ inherited: new Map(), agents: new Map() }),
  preferredMaintenance: () => null
}));
vi.mock("../../src/server/middleware/auth.js", async (original) => ({
  ...await original<typeof import("../../src/server/middleware/auth.js")>(),
  authenticate: () => (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { user: { id: "user-1", email: "admin@example.test", role: "admin" } } as Request["auth"];
    next();
  }
}));
import { createProjectsRouter } from "../../src/server/routes/projects.js";
import { errorHandler } from "../../src/server/errors.js";

const probe = { checked_at: 2000, outcome: "healthy", http_status_code: 200, latency_ms: 12, error_code: null, error_message: null };
const service = { apache: { service_name: "apache2", status: "active" }, nginx: { service_name: "nginx", status: "disabled" }, middleware_api: probe };
const db = { status: "alive", message: "", connection_count: 1, connection_max: 150, threads_running: 1,
  peak_connections: 2, long_queries: 0, db_size_mb: 12, raw: { private_diagnostic: "detail-only" } };
let overrides: Record<string, unknown>;
beforeEach(() => {
  overrides = {};
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM projects")) return [[{ id: "1", public_id: "project-1", name: "Synthetic" }], []];
    if (sql.includes("FROM agents a")) return [[{
      id: "2", public_id: "agent-1", server_name: "api-01", health_api_url: null,
      check_configuration_json: JSON.stringify({ apache: true, nginx: false, middleware_api: true }),
      status: "healthy", probable_cause: null, last_heartbeat_at: "2000", last_metrics_at: "2000", agent_version: "1.3.0",
      last_uptime_seconds: "0", last_uptime_received_at: "1500", last_service_checks_json: JSON.stringify(service),
      latest_database_health_json: JSON.stringify(db), latest_load_5: "0.4", last_load_5_per_core: "0.1",
      last_ram_available_percent: "80", last_disk_available_percent: "50", last_health_outcome: "healthy",
      last_health_http_status_code: 200, last_health_latency_ms: 12, ram_available_threshold_percent: "5",
      disk_available_threshold_percent: "5", load_5_per_core_threshold: "10", heartbeat_interval_seconds: 120,
      telegram_alert_cooldown_seconds: 900, telegram_recovery_cooldown_seconds: 30, middleware_failure_threshold: 2,
      ...overrides
    }], []];
    throw new Error("Unexpected query");
  });
});
function app() { const value = express(); value.use(createProjectsRouter({} as AppConfig)); value.use(errorHandler); return value; }
describe("agent roster API", () => {
  it("returns current check status and independent zero uptime without exposing raw database diagnostics", async () => {
    const response = await request(app()).get("/project-1/agents");
    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({ uptime_seconds: 0, uptime_received_at: 1500, last_heartbeat_at: 2000,
      database_status: "alive", service_health: service, load_5_per_core: 0.1, latest_load_5: 0.4 });
    expect(JSON.stringify(response.body)).not.toContain("private_diagnostic");
    const sql = execute.mock.calls.find(([query]) => query.includes("FROM agents a"))?.[0];
    expect(sql).toContain("m.received_at = a.last_heartbeat_at");
    expect(sql).toContain("m.is_delete = 0 ORDER BY m.id DESC LIMIT 1");
    expect(sql).toContain("a.project_id = ? AND a.is_delete = 0");
  });
  it("returns explicit nulls for agents without uptime or health snapshots", async () => {
    overrides = { last_uptime_seconds: null, last_uptime_received_at: null, last_service_checks_json: null, latest_database_health_json: null };
    const response = await request(app()).get("/project-1/agents");
    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({ uptime_seconds: null, uptime_received_at: null, service_health: null, database_status: null });
  });
  it("degrades corrupt or invalid stored snapshots to null instead of breaking the list", async () => {
    overrides = { last_service_checks_json: "{invalid", latest_database_health_json: JSON.stringify({ status: "alive" }) };
    const response = await request(app()).get("/project-1/agents");
    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({ service_health: null, database_status: null });
  });
});
