import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import type { AppConfig } from "../../src/server/config.js";
const { query, execute, release, destroy, getConnection } = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), release: vi.fn(), destroy: vi.fn(), getConnection: vi.fn()
}));
vi.mock("../../src/server/db.js", () => ({ getPool: () => ({ getConnection }) }));
import { purgeExpiredHistory, RETENTION_INTERVAL_MS } from "../../src/server/services/retention.js";

const config = { database: { name: "synthetic_test" } } as AppConfig;
const now = 1_800_000_000_000;
const day = 86_400_000;
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const run = () => purgeExpiredHistory(config, log as unknown as Logger);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(now);
  getConnection.mockResolvedValue({ query, execute, release, destroy });
  query.mockImplementation(async (sql: string) => {
    if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
    if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
    if (sql.startsWith("SELECT @@")) return [[{ seconds: 50 }]];
    return [[]];
  });
  execute.mockImplementation(async (sql: string) => sql.startsWith("DELETE") ? [{ affectedRows: 0 }] : [[]]);
});
afterEach(() => vi.restoreAllMocks());

describe("retention cleanup", () => {
  it("uses approved age policies, safe deletion order, and protects open/pending records", async () => {
    await run();
    const deletes = execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE"));
    expect(deletes).toHaveLength(7);
    expect(deletes.map(([, args]) => args[0])).toEqual([7, 7, 30, 90, 90, 90, 180].map(days => now - days * day));
    for (const [sql] of deletes) expect(sql).toContain("LIMIT 500");
    expect(deletes[2][0]).toContain("status = 'sent'");
    expect(deletes[3][0]).toContain("status = 'failed'");
    expect(deletes[4][0]).toContain("status = 'cancelled'");
    expect(deletes[5][0]).toContain("status = 'resolved' AND NOT EXISTS");
    expect(deletes[5][0]).toContain("n.incident_id = incidents.id");
    expect(query).toHaveBeenCalledWith("SET SESSION innodb_lock_wait_timeout = ?", [50]);
    expect(release).toHaveBeenCalledOnce();
    expect(RETENTION_INTERVAL_MS).toBe(600_000);
  });
  it("continues full batches and gives every category a turn before repeating", async () => {
    let heartbeatBatches = 0;
    execute.mockImplementation(async (sql: string) => {
      if (sql.startsWith("DELETE FROM heartbeat_events")) return [{ affectedRows: ++heartbeatBatches <= 3 ? 500 : 1 }];
      return sql.startsWith("DELETE") ? [{ affectedRows: 0 }] : [[]];
    });
    await run();
    const deletes = execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE"));
    expect(deletes).toHaveLength(10);
    expect(deletes[6][0]).toContain("audit_events");
    expect(deletes[7][0]).toContain("heartbeat_events");
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ deleted: expect.objectContaining({ heartbeats: 1501 }) }), "Retention cleanup completed");
  });
  it("skips all deletion when another connection owns the lock", async () => {
    query.mockResolvedValue([[{ acquired: 0 }]]);
    await run();
    expect(execute).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledOnce();
  });
  it("stops starting batches after the time budget", async () => {
    let current = now;
    vi.mocked(Date.now).mockImplementation(() => current);
    execute.mockImplementation(async (sql: string) => {
      if (sql.startsWith("DELETE")) { current += 31_000; return [{ affectedRows: 500 }]; }
      return [[]];
    });
    await run();
    expect(execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE"))).toHaveLength(1);
  });
  it("reports lock errors instead of treating them as ordinary contention", async () => {
    query.mockResolvedValueOnce([[{ acquired: null }]]);
    await expect(run()).rejects.toThrow("Database cleanup lock could not be acquired");
    expect(execute).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });
  it("warns about backlog, large allocation and protected old pending deliveries", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.startsWith("DELETE")) return [{ affectedRows: 0 }];
      if (sql.includes("information_schema")) return [[{ allocated_bytes: 2 * 1024 ** 3 }]];
      return [[{ oldest_at: now - 200 * day }]];
    });
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (sql.startsWith("SELECT @@")) return [[{ seconds: 50 }]];
      if (sql.includes("status = 'pending'")) return [[{ oldest_at: now - 8 * day }]];
      return [[]];
    });
    await run();
    expect(log.warn).toHaveBeenCalledTimes(3);
  });
  it("releases the lock after deletion fails and reports partial progress", async () => {
    execute.mockRejectedValueOnce(new Error("Synthetic failure"));
    await expect(run()).rejects.toThrow("Synthetic failure");
    expect(query).toHaveBeenCalledWith("SELECT RELEASE_LOCK(?) AS released", [expect.any(String)]);
    expect(log.error).toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
  it("destroys rather than pooling a connection whose lock cannot be released", async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) throw new Error("Release failed");
      if (sql.startsWith("SELECT @@")) return [[{ seconds: 50 }]];
      return [[]];
    });
    await run();
    expect(destroy).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
  });
});
