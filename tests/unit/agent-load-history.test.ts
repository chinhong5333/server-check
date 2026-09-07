import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config.js";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../src/server/db.js", () => ({ getPool: () => ({ execute }) }));
vi.mock("../../src/server/middleware/auth.js", () => ({
  authenticate: () => (_req: Request, _res: Response, next: NextFunction) => next()
}));
import { createAgentsRouter } from "../../src/server/routes/agents.js";
import { errorHandler } from "../../src/server/errors.js";
import { formatLoadAverage } from "../../src/client/lib/format.js";

describe("raw load history", () => {
  let latest: string | null;
  beforeEach(() => {
    latest = "0.43";
    execute.mockReset();
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM agents a")) return [[{
        id: "1", public_id: "agent-1", project_public_id: "project-1",
        server_name: "Synthetic", status: "healthy", probable_cause: null,
        health_api_url: null, last_heartbeat_at: "2000", last_metrics_at: "2000",
        agent_version: "1.3.0", heartbeat_interval_seconds: 60, latest_load_5: latest
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
    expect(result.body.points[0]).toMatchObject({ load_5: 0.6, load_5_per_core: 0.15 });
    expect(execute.mock.calls[0][0]).toContain("m.received_at = a.last_heartbeat_at");
    expect(execute.mock.calls[1][0]).toContain("AVG(load_5) AS load_5");
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
});
