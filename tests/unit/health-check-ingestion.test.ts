import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../../src/server/security/crypto";
import type { AppConfig } from "../../src/server/config";
const { poolExecute, execute, transact } = vi.hoisted(() => ({ poolExecute: vi.fn(), execute: vi.fn(), transact: vi.fn() }));
vi.mock("../../src/server/db", () => ({ getPool: () => ({ execute: poolExecute }), withTransaction: transact }));
vi.mock("../../src/server/services/incidents", () => ({ resolveHeartbeatIncident: vi.fn(),
  evaluateTelemetryIncidents: vi.fn(async () => ({ status: "healthy", probableCause: null, ramAvailablePercent: 80, diskAvailablePercent: null, load5PerCore: 0 })) }));
import { createHeartbeatRouter } from "../../src/server/routes/heartbeat";
import { errorHandler } from "../../src/server/errors";
const id = "2eaac131-76e2-4d36-b1f4-54ddf5a17a6f";
const credential = `ag_${id}.synthetic-secret`;
const body = {
  sequence_id: 1, observed_at: 1, agent_version: "1.3.0",
  health_probe: { checked_at: 1, outcome: "healthy", http_status_code: 200, latency_ms: 18, error_code: null, error_message: null },
  metrics: { cpu_count: 1, load_1: 0, load_5: 0, load_15: 0, memory_total_bytes: 100,
    memory_available_bytes: 80, swap_total_bytes: 0, swap_free_bytes: 0, uptime_seconds: 100 },
  filesystems: [], top_processes: [], service_checks: {
    apache: { service_name: "apache2", status: "active" }, nginx: { service_name: "nginx", status: "inactive" }
  }
};
function app(checks: unknown) {
  poolExecute.mockResolvedValue([[{ id: "1", public_id: id, project_id: "2", server_name: "Synthetic",
    project_name: "Test", credential_hash: sha256(credential), ram_available_threshold_percent: "15",
    disk_available_threshold_percent: "10", load_5_per_core_threshold: "1", check_configuration_json: checks }]]);
  const result = express(); result.use(createHeartbeatRouter({} as AppConfig), errorHandler); return result;
}
describe("Health result persistence", () => {
  beforeEach(() => {
    execute.mockReset(); poolExecute.mockReset(); transact.mockReset();
    execute.mockImplementation(async (sql: string, values: unknown[]) => {
      expect(sql.match(/\?/g)?.length ?? 0).toBe(values.length);
      return sql.trim().startsWith("SELECT") ? [[]] : [{ insertId: 4, affectedRows: 1 }];
    });
    transact.mockImplementation(async (_config, operation) => operation({ execute }));
  });
  it("persists both service samples and an independently labelled latest snapshot", async () => {
    const response = await request(app(JSON.stringify({ apache: true, nginx: true, middleware_api: true })))
      .post("/").set("authorization", `Bearer ${credential}`).send(body);
    expect(response.status).toBe(202);
    expect(response.body.telemetry_accepted).toBe(true);
    expect(execute.mock.calls.filter(([sql]) => sql.includes("INSERT INTO service_check_samples"))).toHaveLength(2);
    const update = execute.mock.calls.find(([sql]) => sql.includes("last_service_checks_json = ?"));
    const snapshot = JSON.parse(update?.[1][11]);
    expect(snapshot.apache.status).toBe("active"); expect(snapshot.nginx.status).toBe("inactive");
    expect(snapshot.middleware_api.http_status_code).toBe(200);
  });
  it("accepts legacy Apache/API reports without an Nginx field", async () => {
    const response = await request(app(null)).post("/").set("authorization", `Bearer ${credential}`)
      .send({ ...body, service_checks: { apache: body.service_checks.apache } });
    expect(response.status).toBe(202);
    const update = execute.mock.calls.find(([sql]) => sql.includes("last_service_checks_json = ?"));
    expect(JSON.parse(update?.[1][11]).nginx.status).toBe("disabled");
  });
  it("rejects omitted enabled Nginx checks without accepting metrics", async () => {
    const response = await request(app({ apache: true, nginx: true, middleware_api: true }))
      .post("/").set("authorization", `Bearer ${credential}`).send({ ...body, service_checks: { apache: body.service_checks.apache } });
    expect(response.status).toBe(422); expect(response.body.telemetry_accepted).toBe(false);
    expect(execute.mock.calls.some(([sql]) => sql.includes("INSERT INTO metric_samples"))).toBe(false);
  });
});
