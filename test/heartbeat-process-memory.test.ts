import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AppConfig } from "../src/server/config.js";
import { createAgentCredential } from "../src/server/security/crypto.js";

const { poolExecute, execute, transact, warn } = vi.hoisted(() => ({ poolExecute: vi.fn(), execute: vi.fn(), transact: vi.fn(), warn: vi.fn() }));
vi.mock("../src/server/db.js", () => ({ getPool: () => ({ execute: poolExecute }), withTransaction: transact }));
vi.mock("../src/server/services/incidents.js", () => ({
  resolveHeartbeatIncident: vi.fn(), recordAgentCondition: vi.fn(),
  evaluateTelemetryIncidents: vi.fn(async () => ({ status: "healthy", probableCause: null, ramAvailablePercent: 80, diskAvailablePercent: 80, load5PerCore: 0.1 }))
}));
import { createHeartbeatRouter } from "../src/server/routes/heartbeat.js";
import { recordAgentCondition } from "../src/server/services/incidents.js";
import { errorHandler } from "../src/server/errors.js";
import { skipExcessProcessMemory } from "../src/server/services/process-telemetry.js";

// Canonical inputs: checks, base_payload, cases[].top_processes, optional metrics_override/omit_top_processes,
// expected_status, expected_processes and expected_skipped. No deployment environment or credentials are loaded.
const fixtureSchema = z.object({
  checks: z.object({ apache: z.boolean(), nginx: z.boolean(), middleware_api: z.boolean() }).strict(),
  base_payload: z.record(z.string(), z.unknown()),
  cases: z.array(z.object({
    name: z.string().min(1), top_processes: z.array(z.unknown()).optional(),
    metrics_override: z.record(z.string(), z.unknown()).optional(), omit_top_processes: z.boolean().optional(),
    expected_status: z.union([z.literal(202), z.literal(422)]), expected_processes: z.array(z.unknown()),
    expected_skipped: z.array(z.object({ process_index: z.number().int().nonnegative(), memory_percent: z.number() }).strict())
  }).strict())
}).strict();
const fixture = fixtureSchema.parse(JSON.parse(readFileSync(new URL("./inputs/process-memory.example.json", import.meta.url), "utf8")));

beforeEach(() => {
  vi.mocked(recordAgentCondition).mockClear(); warn.mockReset(); execute.mockReset(); poolExecute.mockReset(); transact.mockReset();
  execute.mockImplementation(async (sql: string, values: unknown[]) => {
    expect(sql.match(/\?/g)?.length ?? 0).toBe(values.length);
    if (sql.includes("SELECT middleware_failure_threshold")) return [[{ middleware_failure_threshold: 2, middleware_failure_count: 0 }]];
    if (sql.includes("FROM agents") && sql.includes("FOR UPDATE")) return [[{ id: "1" }]];
    return sql.trim().startsWith("SELECT") ? [[]] : [{ insertId: 4, affectedRows: 1 }];
  });
  transact.mockImplementation(async (_config, operation) => operation({ execute }));
});

for (const entry of fixture.cases) it(entry.name, async () => {
  const payload = { ...fixture.base_payload,
    metrics: { ...(fixture.base_payload.metrics as Record<string, unknown>), ...entry.metrics_override },
    ...(entry.omit_top_processes ? {} : { top_processes: entry.top_processes }) };
  const original = JSON.stringify(payload);
  expect(skipExcessProcessMemory(payload).skipped).toEqual(entry.expected_skipped);
  expect(JSON.stringify(payload)).toBe(original);
  const id = randomUUID(), credential = createAgentCredential(id);
  poolExecute.mockResolvedValue([[{ id: "1", public_id: id, project_id: "2", server_name: "Synthetic", project_name: "Test",
    credential_hash: credential.credentialHash, ram_available_threshold_percent: "15", disk_available_threshold_percent: "10",
    load_5_per_core_threshold: "1", check_configuration_json: fixture.checks }]]);
  const app = express();
  app.use((req, _res, next) => { req.log = { warn } as typeof req.log; next(); });
  app.use(createHeartbeatRouter({} as AppConfig), errorHandler);
  const response = await request(app).post("/").set("authorization", `Bearer ${credential.credential}`).send(payload);
  expect(response.status).toBe(entry.expected_status);
  expect(response.body.heartbeat_accepted).toBe(true);
  const insert = execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO metric_samples"));
  if (entry.expected_status === 202) {
    expect(response.body.telemetry_accepted).toBe(true);
    expect(insert).toBeDefined();
    const values = insert![1] as unknown[];
    expect(JSON.parse(values[22] as string)).toEqual(entry.expected_processes);
    const metrics = payload.metrics;
    expect(values.slice(6, 15)).toEqual([metrics.cpu_count, metrics.load_1, metrics.load_5, metrics.load_15,
      String(metrics.memory_total_bytes), String(metrics.memory_available_bytes), String(metrics.swap_total_bytes),
      String(metrics.swap_free_bytes), String(metrics.uptime_seconds)]);
    expect(values[21]).toBe(JSON.stringify(fixture.base_payload.database_health));
    expect(execute.mock.calls.filter(([sql]) => sql.includes("INSERT INTO filesystem_samples"))).toHaveLength(1);
    expect(execute.mock.calls.filter(([sql]) => sql.includes("INSERT INTO service_check_samples"))).toHaveLength(2);
    expect(recordAgentCondition).not.toHaveBeenCalled();
  } else {
    expect(response.body.telemetry_accepted).toBe(false);
    expect(insert).toBeUndefined();
    expect(recordAgentCondition).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ type: "telemetry_invalid" }), expect.any(Number));
  }
  if (entry.expected_skipped.length) expect(warn).toHaveBeenCalledWith({ agent_id: id,
    skipped_count: entry.expected_skipped.length, skipped_processes: entry.expected_skipped },
    "Skipped process records with reported RAM usage above 100%");
  else expect(warn).not.toHaveBeenCalled();
});
