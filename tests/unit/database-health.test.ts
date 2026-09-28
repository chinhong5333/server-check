import { afterEach, expect, it, vi } from "vitest";
import { createDatabaseHealthProbe } from "../../src/server/services/database-health";

afterEach(() => vi.useRealTimers());

it("reports the exact alive DB fields and caches size for one minute", async () => {
  const query = vi.fn(async (sql: string): Promise<Record<string, unknown>[]> => {
    if (sql === "SELECT 1") return [{ "1": 1 }];
    if (sql.startsWith("SHOW STATUS")) return [
      { Variable_name: "Threads_connected", Value: "58" },
      { Variable_name: "Threads_running", Value: "1" },
      { Variable_name: "Max_used_connections", Value: "67" }
    ];
    if (sql.startsWith("SHOW VARIABLES")) return [{ Variable_name: "max_connections", Value: "150" }];
    if (sql.includes("information_schema.processlist")) return [{ n: "0" }];
    if (sql.includes("information_schema.tables")) return [{ size_mb: "8329.7", free_mb: "46.0" }];
    throw new Error("Unexpected query");
  });
  const probe = createDatabaseHealthProbe(query);
  expect(await probe()).toEqual({ status: "alive", message: "", connection_count: 58, connection_max: 150,
    threads_running: 1, peak_connections: 67, long_queries: 0, db_size_mb: "8329.7", fragmented_mb: "46.0" });
  await probe();
  expect(query.mock.calls.filter(([sql]) => sql.includes("information_schema.tables"))).toHaveLength(1);
});

it("reports DB failure with null metrics and no raw error disclosure", async () => {
  const query = vi.fn(async () => { throw new Error("secret host and SQL details"); });
  const onError = vi.fn();
  const result = await createDatabaseHealthProbe(query, onError)();
  expect(result).toEqual({ status: "fail", message: "db probe unavailable", connection_count: null,
    connection_max: null, threads_running: null, peak_connections: null, long_queries: null,
    db_size_mb: null, fragmented_mb: null });
  expect(query).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith("db probe unavailable");
});

it("keeps DB alive when optional metrics fail", async () => {
  const query = vi.fn(async (sql: string) => {
    if (sql === "SELECT 1") return [{ "1": 1 }];
    throw new Error("private database identifier");
  });
  const result = await createDatabaseHealthProbe(query)();
  expect(result).toMatchObject({ status: "alive", message: "metrics unavailable: db metrics unavailable",
    connection_count: null, long_queries: null, db_size_mb: null, fragmented_mb: null });
  expect(JSON.stringify(result)).not.toContain("private database identifier");
});

it("ends a stalled DB probe after two seconds", async () => {
  vi.useFakeTimers();
  const pending = createDatabaseHealthProbe(() => new Promise(() => {}))();
  await vi.advanceTimersByTimeAsync(2000);
  expect(await pending).toMatchObject({ status: "fail", message: "db probe timeout after 2000ms" });
});
