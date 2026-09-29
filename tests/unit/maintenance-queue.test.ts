import { expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import { queueTelegramNotification } from "../../src/server/services/alert-queue";

it.each(["opened", "resolved"] as const)("suppresses %s notifications while maintenance remains active", async event => {
  const execute = vi.fn(async (sql: string) => sql.startsWith("SELECT w.id") ? [[{ id: "maintenance" }]] : [{ affectedRows: 1 }]);
  await queueTelegramNotification({ execute } as unknown as PoolConnection, "1", "42", event, { incident_type: "database_not_alive" }, 1000);
  expect(execute.mock.calls.some(([sql]) => sql.includes("INSERT INTO notification_outbox"))).toBe(false);
  expect(execute.mock.calls.some(([sql]) => sql.includes("Suppressed during maintenance"))).toBe(true);
});
