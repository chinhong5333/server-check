import { expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import { telemetryPayloadSchema } from "../../src/shared/contracts";
import { evaluateTelemetryIncidents } from "../../src/server/services/incidents";

const policy = { agentInternalId: "2", agentPublicId: "agent", serverName: "Synthetic", projectInternalId: "1", projectName: "Test", ramThreshold: 15, diskThreshold: 10, loadThreshold: 1 };
const payload = telemetryPayloadSchema.parse({ sequence_id: 1, observed_at: 1, agent_version: "1.4.0",
  health_probe: { checked_at: 1, outcome: "healthy", http_status_code: 200, latency_ms: 10, error_code: null, error_message: null },
  metrics: { cpu_count: 1, load_1: 0, load_5: 0, load_15: 0, memory_total_bytes: 100, memory_available_bytes: 80, swap_total_bytes: 0, swap_free_bytes: 0, uptime_seconds: 100 },
  filesystems: [], top_processes: [], service_checks: { apache: { service_name: "apache", status: "disabled" } } });
const db = { status: "fail", message: "DB probe timed out", connection_count: null, connection_max: null, threads_running: null, peak_connections: null, long_queries: null, db_size_mb: null };

it("opens a critical DB incident on the first failure even when HTTP is 200", async () => {
  const execute = vi.fn(async (sql: string) => sql.trim().startsWith("SELECT") ? [[]] : [{ insertId: 42 }]);
  const result = await evaluateTelemetryIncidents({ execute } as unknown as PoolConnection, policy, { ...payload, database_health: db }, 1000);
  expect(result.status).toBe("critical");
  const incident = execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO incidents"));
  expect(incident).toBeDefined();
  const outbox = execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO notification_outbox"));
  expect(outbox).toBeDefined();
  expect(result.probableCause).toBe("The database did not report alive");
});

it("requires an explicit alive report to recover an existing DB incident", async () => {
  const execute = vi.fn(async (sql: string) => sql.includes("FROM incidents") && sql.startsWith("SELECT")
    ? [[{ id: "42", public_id: "db-incident", incident_type: "database_not_alive" }]]
    : sql.trim().startsWith("SELECT") ? [[]] : [{ insertId: 1 }]);
  const connection = { execute } as unknown as PoolConnection;
  const missing = await evaluateTelemetryIncidents(connection, policy, payload, 1000);
  expect(missing.status).toBe("critical");
  expect(execute.mock.calls.some(([sql]) => sql.includes("SET status = 'resolved'"))).toBe(false);
  execute.mockClear();
  const recovered = await evaluateTelemetryIncidents(connection, policy, { ...payload, database_health: { ...db, status: "alive", message: "" } }, 2000);
  expect(recovered.status).toBe("healthy");
  expect(execute.mock.calls.some(([sql]) => sql.includes("SET status = 'resolved'"))).toBe(true);
  expect(execute.mock.calls.some(([sql]) => sql.includes("INSERT INTO notification_outbox"))).toBe(true);
});
