import { randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { assertSafeTestDatabase, loadConfig, type AppConfig } from "../../src/server/config.js";
import { closePool, getPool, withTransaction } from "../../src/server/db.js";
import { lockAgentAlerts } from "../../src/server/services/alert-queue.js";
import { recordAgentCondition, resolveAgentCondition } from "../../src/server/services/incidents.js";
import { runMigrations } from "../../src/server/migrations.js";
import { purgeExpiredHistory } from "../../src/server/services/retention.js";
import { advanceMiddlewareFailures } from "../../src/server/services/middleware-failures.js";

let config: AppConfig;
let projectId: number | undefined;
let agentId: number;

it("persists middleware streaks across transactions and rolls back rejected reports", async () => {
  await getPool(config).execute("UPDATE agents SET middleware_failure_threshold = 3, middleware_failure_count = 0 WHERE id = ?", [agentId]);
  expect(await withTransaction(config, connection => advanceMiddlewareFailures(connection, String(agentId), "unhealthy"))).toEqual({ count: 1, threshold: 3 });
  expect(await withTransaction(config, connection => advanceMiddlewareFailures(connection, String(agentId), "unhealthy"))).toEqual({ count: 2, threshold: 3 });
  await expect(withTransaction(config, async connection => { await advanceMiddlewareFailures(connection, String(agentId), "unhealthy"); throw new Error("Reject synthetic transaction"); })).rejects.toThrow("Reject synthetic transaction");
  expect(await withTransaction(config, connection => advanceMiddlewareFailures(connection, String(agentId), "unhealthy"))).toEqual({ count: 3, threshold: 3 });
  expect(await withTransaction(config, connection => advanceMiddlewareFailures(connection, String(agentId), "healthy"))).toEqual({ count: 0, threshold: 3 });
});
const now = Date.now();
const day = 86_400_000;
const stamp = { created_at: now, updated_at: now, is_delete: 0 };

// All table/column names are fixed test fixture literals, not external inputs.
async function insert(table: string, values: Record<string, unknown>) {
  const keys = Object.keys(values);
  const [result] = await getPool(config).execute<ResultSetHeader>(
    `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, Object.values(values)
  );
  return result.insertId;
}
async function exists(table: string, id: number) {
  const [rows] = await getPool(config).execute<RowDataPacket[]>(`SELECT id FROM ${table} WHERE id = ?`, [id]);
  return rows.length === 1;
}

beforeAll(async () => {
  config = loadConfig();
  assertSafeTestDatabase(config);
  const [rows] = await getPool(config).query<RowDataPacket[]>("SELECT VERSION() AS version");
  const version = String(rows[0]?.version);
  if (/mariadb/i.test(version) || Number.parseInt(version) < 8) throw new Error("Retention integration requires dedicated local MySQL 8+");
  await runMigrations(config);
  const id = randomUUID();
  projectId = await insert("projects", { public_id: id, name: "Retention synthetic", slug: id,
    ram_available_threshold_percent: 15, disk_available_threshold_percent: 10,
    load_5_per_core_threshold: 1.5, heartbeat_interval_seconds: 60, heartbeat_grace_seconds: 0, ...stamp });
  agentId = await insert("agents", { public_id: randomUUID(), project_id: projectId, server_name: "Retention synthetic",
    health_api_url: null, health_request_timeout_seconds: 5, apache_service_name: "apache2",
    credential_hash: "0".repeat(64), credential_hint: "synthetic", ram_available_threshold_percent: 15,
    disk_available_threshold_percent: 10, load_5_per_core_threshold: 1.5, heartbeat_interval_seconds: 60, ...stamp });
});

afterAll(async () => {
  if (projectId !== undefined) {
    for (const table of ["notification_outbox", "incidents", "audit_events", "metric_samples", "heartbeat_events", "agents"]) {
      await getPool(config).execute(`DELETE FROM ${table} WHERE project_id = ?`, [projectId]);
    }
    await getPool(config).execute("DELETE FROM projects WHERE id = ?", [projectId]);
  }
  if (config) await closePool();
});

it("retains current/protected data and purges expired parents plus cascading samples", async () => {
  const parent = { project_id: projectId, agent_id: agentId };
  const old = now - 8 * day;
  const heartbeat = await insert("heartbeat_events", { ...parent, received_at: old, has_payload: 1, telemetry_valid: 1, ...stamp });
  const current = await insert("heartbeat_events", { ...parent, received_at: now, has_payload: 1, telemetry_valid: 1, ...stamp });
  const metric = await insert("metric_samples", { ...parent, sequence_id: 1, observed_at: old, received_at: old,
    agent_version: "synthetic", health_checked_at: old, health_outcome: "healthy", top_processes_json: "[]", ...stamp });
  const filesystem = await insert("filesystem_samples", { ...parent, metric_sample_id: metric, observed_at: old,
    filesystem: "synthetic", mount_point: "/synthetic", total_bytes: 100, available_bytes: 50, ...stamp });
  const service = await insert("service_check_samples", { ...parent, metric_sample_id: metric, observed_at: old,
    service_name: "synthetic", service_status: "active", ...stamp });
  const incident = async (status: string) => insert("incidents", { ...parent, public_id: randomUUID(),
    incident_type: "heartbeat_missed", severity: "critical", status, probable_cause: "synthetic",
    details_json: "{}", opened_at: now - 120 * day, resolved_at: status === "resolved" ? now - 100 * day : null, ...stamp });
  const resolved = await incident("resolved");
  const blocked = await incident("resolved");
  const open = await incident("open");
  const recentDeliveryIncident = await incident("resolved");
  const delivery = async (incident_id: number, status: string, age: number) => insert("notification_outbox", {
    project_id: projectId, incident_id, channel: "telegram", event_type: "opened", payload_json: "{}",
    status, attempt_count: 1, next_attempt_at: now, sent_at: status === "sent" ? now - age * day : null,
    ...stamp, created_at: now - age * day, updated_at: now - age * day
  });
  const sent = await delivery(resolved, "sent", 31);
  const failed = await delivery(resolved, "failed", 91);
  const pending = await delivery(blocked, "pending", 200);
  const recent = await delivery(recentDeliveryIncident, "sent", 1);
  const audit = await insert("audit_events", { project_id: projectId, action: "synthetic", entity_type: "test",
    entity_id: "test", metadata_json: "{}", ...stamp, created_at: now - 181 * day });

  await purgeExpiredHistory(config, pino({ enabled: false }));
  for (const [table, id] of [["heartbeat_events", heartbeat], ["metric_samples", metric], ["filesystem_samples", filesystem],
    ["service_check_samples", service], ["notification_outbox", sent], ["notification_outbox", failed],
    ["incidents", resolved], ["audit_events", audit]] as const) expect(await exists(table, id)).toBe(false);
  for (const [table, id] of [["heartbeat_events", current], ["incidents", blocked], ["incidents", open],
    ["incidents", recentDeliveryIncident], ["notification_outbox", pending], ["notification_outbox", recent]] as const) {
    expect(await exists(table, id)).toBe(true);
  }
});

it("deduplicates concurrent collection and requeues only after pending delivery ends",async()=>{
  const identity={agentInternalId:String(agentId),agentPublicId:"synthetic-agent",serverName:"Synthetic",projectInternalId:String(projectId),projectName:"Synthetic"};
  const condition={type:"synthetic_recurrence",severity:"warning" as const,probableCause:"Synthetic persistent error",details:{}};
  const collect=()=>withTransaction(config,async connection=>{
    await lockAgentAlerts(connection,String(agentId));await recordAgentCondition(connection,identity,condition,Date.now());
  });
  await Promise.all([collect(),collect(),collect(),collect()]);
  const read=async()=>{
    const [rows]=await getPool(config).execute<RowDataPacket[]>(`SELECT o.status, o.event_type FROM notification_outbox o INNER JOIN incidents i ON i.id=o.incident_id WHERE i.agent_id=? AND i.incident_type='synthetic_recurrence' ORDER BY o.id`,[agentId]);return rows;
  };
  expect(await read()).toHaveLength(1);
  await getPool(config).execute(`UPDATE notification_outbox o INNER JOIN incidents i ON i.id=o.incident_id SET o.status='sent',o.sent_at=? WHERE i.agent_id=? AND i.incident_type='synthetic_recurrence'`,[Date.now(),agentId]);
  await collect();expect((await read()).map(row=>row.status)).toEqual(["sent","pending"]);
  await withTransaction(config,async connection=>{await lockAgentAlerts(connection,String(agentId));await resolveAgentCondition(connection,identity,"synthetic_recurrence",Date.now());});
  expect((await read()).map(row=>[row.event_type,row.status])).toEqual([["opened","sent"],["opened","cancelled"],["resolved","pending"]]);
});
