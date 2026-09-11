import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config.js";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../src/server/db.js", () => ({ getPool: () => ({ execute }) }));
vi.mock("../../src/server/middleware/auth.js", async (original) => ({
  ...await original<typeof import("../../src/server/middleware/auth.js")>(),
  authenticate: () => (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { user: { id: "user-1", email: "admin@example.test", role: "admin" } } as Request["auth"];
    next();
  }
}));
import { createAgentsRouter } from "../../src/server/routes/agents.js";
import { errorHandler } from "../../src/server/errors.js";
import { formatLoadAverage } from "../../src/client/lib/format.js";

describe("raw load history", () => {
  let latest: string | null;
  let resourceOverrides: Record<string, string | null>;
  beforeEach(() => {
    latest = "0.43";
    resourceOverrides = {};
    execute.mockReset();
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM agents a")) return [[{
        id: "1", public_id: "agent-1", project_public_id: "project-1",
        server_name: "Synthetic", status: "healthy", probable_cause: null,
        health_api_url: null, last_heartbeat_at: "2000", last_metrics_at: "2000",
        agent_version: "1.3.0", heartbeat_interval_seconds: 60,
        middleware_failure_count: 1, middleware_failure_threshold: 2, latest_load_5: latest,
        latest_ram_total_bytes: "8000000000", latest_ram_available_bytes: "3860000000",
        latest_storage_total_bytes: "100000000000", latest_storage_available_bytes: "60000000000", latest_storage_mount_point: "/",
        ...resourceOverrides
      }], []];
      if (sql.includes("FROM metric_samples")) return [[{
        bucket_at: "0", ram_available_percent: null, load_5: "0.60",
        load_5_per_core: "0.15", health_latency_ms: null, healthy_ratio: null
      }], []];
      if (sql.includes("FROM filesystem_samples")) return [[], []];
      throw new Error("Unexpected query");
    });
  });
  function app() {
    const result = express();
    result.use(createAgentsRouter({} as AppConfig));
    result.use(errorHandler);
    return result;
  }
  it("separates raw bucket averages from the latest heartbeat and retains normalized history", async () => {
    const result = await request(app()).get("/agent-1/history?from=0&to=3000&bucket_seconds=1800");
    expect(result.status).toBe(200);
    expect(result.body.latest_load_5).toBe(0.43);
    expect(result.body.agent).toMatchObject({ middleware_failure_count: 1, middleware_failure_threshold: 2 });
    expect(result.body.latest_resources).toEqual({
      ram: { used_bytes: 4140000000, total_bytes: 8000000000, utilization_percent: 51.75 },
      storage: { used_bytes: 40000000000, total_bytes: 100000000000, utilization_percent: 40, mount_point: "/" }
    });
    expect(execute.mock.calls[0][0]).toContain("f.metric_sample_id = latest.id");
    expect(execute.mock.calls[0][0]).toContain("f.mount_point = '/'");
    expect(execute.mock.calls[0][0]).toContain("ORDER BY f.id ASC");
    expect(result.body.points[0]).toMatchObject({ load_5: 0.6, load_5_per_core: 0.15 });
    expect(execute.mock.calls[0][0]).toContain("m.received_at = a.last_heartbeat_at");
    expect(execute.mock.calls[1][0]).toContain("AVG(load_5) AS load_5");
    expect(execute.mock.calls[2][0]).toContain("mount_point = '/'");
  });
  it.each([null, "0"])("preserves unavailable or zero latest readings (%s)", async (value) => {
    latest = value;
    const result = await request(app()).get("/agent-1/history?from=0&to=3000&bucket_seconds=1800");
    expect(result.status).toBe(200);
    expect(result.body.latest_load_5).toBe(value === null ? null : 0);
  });
  it("formats raw load without a ratio suffix", () => {
    expect(formatLoadAverage(0.43)).toBe("0.43");
    expect(formatLoadAverage(0)).toBe("0.00");
    expect(formatLoadAverage(null)).toBe("--");
  });
  it.each([[null,null],["0","0"],["10","11"],["9007199254740993","0"]])("does not invent capacity for invalid totals (%s, %s)", async (total,available) => {
    resourceOverrides={latest_ram_total_bytes:total,latest_ram_available_bytes:available,
      latest_storage_total_bytes:total,latest_storage_available_bytes:available};
    const result=await request(app()).get("/agent-1/history?from=0&to=3000&bucket_seconds=1800");
    expect(result.status).toBe(200);
    expect(result.body.latest_resources).toEqual({ram:null,storage:null});
  });
  it("preserves zero usage in a valid capacity pair",async()=>{
    resourceOverrides={latest_ram_total_bytes:"8000000000",latest_ram_available_bytes:"8000000000"};
    const result=await request(app()).get("/agent-1/history?from=0&to=3000&bucket_seconds=1800");
    expect(result.body.latest_resources.ram).toEqual({used_bytes:0,total_bytes:8000000000,utilization_percent:0});
  });
});
