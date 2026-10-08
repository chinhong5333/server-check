import { expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import { observeServerUptime } from "../../src/server/services/server-uptime";

const agent = { agentInternalId: "1", agentPublicId: "synthetic", projectInternalId: "2", projectName: "Test", serverName: "Synthetic" };
function fixture(maintenance = false) {
  let baseline: { last_uptime_seconds: string | null; last_uptime_observed_at: string | null } = { last_uptime_seconds: null, last_uptime_observed_at: null };
  const events: unknown[][] = [], messages: unknown[][] = [];
  const execute = vi.fn(async (sql: string, values: unknown[] = []) => {
    expect(sql.match(/\?/g)?.length ?? 0).toBe(values.length);
    if (sql.includes("SELECT last_uptime_seconds")) return [[{ ...baseline }]];
    if (sql.includes("UPDATE agents SET last_uptime_seconds")) baseline = { last_uptime_seconds: String(values[0]), last_uptime_observed_at: String(values[1]) };
    if (sql.includes("INSERT INTO incidents")) { events.push(values); return [{ insertId: events.length }]; }
    if (sql.includes("FROM maintenance_windows")) return [maintenance ? [{ id: "maintenance" }] : []];
    if (sql.includes("SELECT id FROM notification_outbox")) return [[]];
    if (sql.includes("INSERT INTO notification_outbox")) messages.push(values);
    return [{ affectedRows: 1 }];
  });
  return { connection: { execute } as unknown as PoolConnection, events, messages, execute, baseline: () => baseline };
}
it("sets the first valid uptime baseline and advances it without a restart alert", async () => {
  const s = fixture();
  await observeServerUptime(s.connection, agent, 0, 1000, 1100);
  await observeServerUptime(s.connection, agent, 120, 121000, 121100);
  expect(s.baseline().last_uptime_seconds).toBe("120");
  expect(s.events).toHaveLength(0); expect(s.messages).toHaveLength(0);
});
it("records one completed event for a decrease without an ongoing issue or recovery", async () => {
  const s = fixture();
  await observeServerUptime(s.connection, agent, 100000, 1000, 1100);
  await observeServerUptime(s.connection, agent, 30, 2000, 2100);
  await observeServerUptime(s.connection, agent, 60, 3000, 3100);
  expect(s.events).toHaveLength(1); expect(s.messages).toHaveLength(1);
  expect(s.events[0]?.[3]).toBe("server_restart");
  expect(s.execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO incidents"))?.[0]).toContain("'warning', 'resolved'");
  expect(s.messages[0]?.[2]).toBe("opened");
  expect(JSON.parse(String(s.messages[0]?.[3])).details).toMatchObject({ previous_uptime_seconds: 100000, current_uptime_seconds: 30 });
  expect(s.messages.some(values => values[2] === "resolved")).toBe(false);
});
it("ignores missing, repeated and older uptime reports without resetting the valid baseline", async () => {
  const s = fixture();
  await observeServerUptime(s.connection, agent, 100000, 2000, 2100);
  await observeServerUptime(s.connection, agent, null, 4000, 4100);
  await observeServerUptime(s.connection, agent, 30, 2000, 4200);
  await observeServerUptime(s.connection, agent, 20, 1000, 4300);
  expect(s.baseline()).toEqual({ last_uptime_seconds: "100000", last_uptime_observed_at: "2000" });
  expect(s.events).toHaveLength(0); expect(s.messages).toHaveLength(0);
});
it("records a maintenance restart in history while suppressing its Telegram collection", async () => {
  const s = fixture(true);
  await observeServerUptime(s.connection, agent, 100000, 1000, 1100);
  await observeServerUptime(s.connection, agent, 30, 2000, 2100);
  expect(s.events).toHaveLength(1); expect(s.messages).toHaveLength(0);
  expect(s.baseline().last_uptime_seconds).toBe("30");
});
