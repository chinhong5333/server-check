import { expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config";
const { execute, candidates } = vi.hoisted(() => ({ execute: vi.fn(), candidates: vi.fn() }));
vi.mock("../../src/server/db.js", () => ({ getPool: () => ({ execute: candidates }), withTransaction: async (_config: unknown, operation: (connection: unknown) => Promise<void>) => operation({ execute }) }));
import { processMaintenanceWindows } from "../../src/server/services/maintenance-lifecycle";

it("handles scheduled starts and overlapping expiry once without replaying healthy/recovered alerts", async () => {
  let now = 1000;
  const windows = [
    { id: "10", agent_id: null, starts_at: 1000, ends_at: 2000, ended_at: null, activated_at: null as number | null, completed_at: null as number | null },
    { id: "11", agent_id: "2", starts_at: 1000, ends_at: 2500, ended_at: null, activated_at: null as number | null, completed_at: null as number | null }
  ];
  const eligible = () => windows.filter(w => w.completed_at === null && (w.activated_at === null && w.starts_at <= now || w.ends_at <= now));
  candidates.mockImplementation(async () => [eligible().length ? [{ project_id: "1" }] : []]);
  execute.mockImplementation(async (sql: string, values: unknown[]) => {
    if (sql.startsWith("SELECT id, name FROM projects")) return [[{ id: "1", name: "Synthetic" }]];
    if (sql.startsWith("SELECT id, public_id, server_name FROM agents")) return [[{ id: "2", public_id: "agent-2", server_name: "Broken" }, { id: "3", public_id: "agent-3", server_name: "Healthy" }]];
    if (sql.startsWith("SELECT * FROM maintenance_windows")) return [eligible()];
    if (sql.includes("SET activated_at")) windows.find(w => w.id === values[2])!.activated_at = now;
    if (sql.includes("SET completed_at")) windows.find(w => w.id === values[2])!.completed_at = now;
    if (sql.startsWith("SELECT w.id")) return [windows.filter(w => w.ended_at === null && w.starts_at <= now && w.ends_at > now && (w.agent_id === null || w.agent_id === values[0]))];
    if (sql.includes("SELECT id, public_id, incident_type")) return [values[0] === "2" ? [{ id: "42", public_id: "incident", incident_type: "database_not_alive", severity: "critical", probable_cause: "DB failed", details_json: {} }] : []];
    return sql.startsWith("SELECT") ? [[]] : [{ affectedRows: 1 }];
  });
  await processMaintenanceWindows({} as AppConfig, now);
  expect(execute.mock.calls.some(([sql]) => sql.includes("INSERT INTO notification_outbox"))).toBe(false);
  now = 2000; await processMaintenanceWindows({} as AppConfig, now);
  expect(execute.mock.calls.some(([sql]) => sql.includes("INSERT INTO notification_outbox"))).toBe(false);
  now = 2500; await processMaintenanceWindows({} as AppConfig, now);
  await processMaintenanceWindows({} as AppConfig, now);
  expect(execute.mock.calls.filter(([sql]) => sql.includes("INSERT INTO notification_outbox"))).toHaveLength(1);
  expect(execute.mock.calls.filter(([sql]) => sql.includes("Suppressed during maintenance")).some(([, values]) => values[2] === 1999)).toBe(true);
  expect(windows.every(w => w.completed_at !== null)).toBe(true);
});
