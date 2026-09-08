import { createHash } from "node:crypto";
import type { Logger } from "pino";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import type { AppConfig } from "../config.js";
import { getPool } from "../db.js";

const DAY = 86_400_000;
export const RETENTION_INTERVAL_MS = 10 * 60_000;
const BATCH_SIZE = 500;
const MAX_ROUNDS = 100;
const RUN_BUDGET_MS = 30_000;
const SIZE_WARNING_BYTES = 1024 ** 3;

// Static identifiers only: no user-supplied SQL or retention expressions.
const policies = [
  { name: "heartbeats", table: "heartbeat_events", time: "received_at", days: 7, condition: "" },
  { name: "metrics", table: "metric_samples", time: "received_at", days: 7, condition: "" },
  { name: "sent_deliveries", table: "notification_outbox", time: "sent_at", days: 30, condition: "status = 'sent' AND " },
  { name: "failed_deliveries", table: "notification_outbox", time: "updated_at", days: 90, condition: "status = 'failed' AND " },
  { name: "cancelled_deliveries", table: "notification_outbox", time: "updated_at", days: 90, condition: "status = 'cancelled' AND " },
  { name: "resolved_incidents", table: "incidents", time: "resolved_at", days: 90,
    condition: "status = 'resolved' AND NOT EXISTS (SELECT 1 FROM notification_outbox n WHERE n.incident_id = incidents.id) AND " },
  { name: "audit_events", table: "audit_events", time: "created_at", days: 180, condition: "" }
] as const;

/**
 * Purges expired history in bounded, autocommitted batches on one dedicated connection.
 * A database-scoped advisory lock excludes other cleanup instances. Pending deliveries
 * and open incidents are never candidates; incident deletion also requires no remaining deliveries.
 * @param {AppConfig} config Existing database configuration; no additional database is accessed.
 * @param {Logger} logger Structured cleanup results, capacity/backlog warnings, and failures.
 * @returns {Promise<void>} Resolves after cleanup or a lock-contention skip; rejects on database errors.
 */
export async function purgeExpiredHistory(config: AppConfig, logger: Logger): Promise<void> {
  const started = Date.now();
  const connection = await getPool(config).getConnection();
  const lockName = `server-check-retention-${createHash("sha256").update(config.database.name).digest("hex").slice(0, 32)}`;
  let acquired = false;
  let originalLockWait: number | undefined;
  let reusable = true;
  const deleted: Record<string, number> = Object.fromEntries(policies.map((p) => [p.name, 0]));
  try {
    const [lock] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS acquired", [lockName]);
    if (lock[0]?.acquired == null) throw new Error("Database cleanup lock could not be acquired");
    acquired = Number(lock[0]?.acquired) === 1;
    if (!acquired) {
      logger.info({ worker: "history-retention", skipped: true }, "Cleanup already running on another connection");
      return;
    }
    const [session] = await connection.query<RowDataPacket[]>("SELECT @@SESSION.innodb_lock_wait_timeout AS seconds");
    originalLockWait = Number(session[0]?.seconds);
    if (!Number.isInteger(originalLockWait) || originalLockWait < 1) throw new Error("Invalid cleanup lock-wait setting");
    await connection.query("SET SESSION innodb_lock_wait_timeout = 2");

    const complete = new Set<string>();
    // Round-robin prevents a large telemetry backlog from starving log cleanup.
    for (let round = 0; round < MAX_ROUNDS && complete.size < policies.length; round++) {
      for (const policy of policies) {
        if (Date.now() - started >= RUN_BUDGET_MS) break;
        if (complete.has(policy.name)) continue;
        const [result] = await connection.execute<ResultSetHeader>(
          `DELETE FROM ${policy.table} WHERE ${policy.condition}${policy.time} < ? ORDER BY ${policy.time}, id LIMIT ${BATCH_SIZE}`,
          [started - policy.days * DAY]
        );
        deleted[policy.name] += result.affectedRows;
        if (result.affectedRows < BATCH_SIZE) complete.add(policy.name);
      }
      if (Date.now() - started >= RUN_BUDGET_MS) break;
    }

    const oldestEligible: Record<string, number | null> = {};
    for (const policy of policies) {
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT ${policy.time} AS oldest_at FROM ${policy.table} WHERE ${policy.condition}${policy.time} < ? ORDER BY ${policy.time}, id LIMIT 1`,
        [started - policy.days * DAY]
      );
      oldestEligible[policy.name] = rows[0] ? Number(rows[0].oldest_at) : null;
    }
    const [storage] = await connection.execute<RowDataPacket[]>(
      "SELECT COALESCE(SUM(data_length + index_length), 0) AS allocated_bytes FROM information_schema.tables WHERE table_schema = ?",
      [config.database.name]
    );
    const [pending] = await connection.query<RowDataPacket[]>(
      "SELECT created_at AS oldest_at FROM notification_outbox WHERE status = 'pending' ORDER BY created_at, id LIMIT 1"
    );
    const allocatedBytes = Number(storage[0]?.allocated_bytes ?? 0);
    const oldestPendingAt = pending[0] ? Number(pending[0].oldest_at) : null;
    const backlog = Object.values(oldestEligible).some((value) => value !== null);
    const details = { worker: "history-retention", deleted, duration_ms: Date.now() - started,
      oldest_eligible_at: oldestEligible, backlog, allocated_bytes: allocatedBytes,
      size_warning_bytes: SIZE_WARNING_BYTES, oldest_pending_at: oldestPendingAt };
    logger.info(details, "Retention cleanup completed");
    if (backlog) logger.warn(details, "Expired data remains; cleanup will continue on the next run");
    if (allocatedBytes >= SIZE_WARNING_BYTES) logger.warn(details, "Database allocation exceeds 1 GiB; review capacity and disk free space");
    if (oldestPendingAt !== null && oldestPendingAt < started - 7 * DAY) {
      logger.warn(details, "Pending deliveries older than seven days are protected; resolve the delivery backlog");
    }
  } catch (error) {
    logger.error({ worker: "history-retention", err: error, deleted, duration_ms: Date.now() - started }, "Retention cleanup failed; completed batches remain committed");
    throw error;
  } finally {
    try {
      if (originalLockWait !== undefined && Number.isInteger(originalLockWait) && originalLockWait > 0) {
        await connection.query("SET SESSION innodb_lock_wait_timeout = ?", [originalLockWait]);
      }
      if (acquired) {
        const [released] = await connection.query<RowDataPacket[]>("SELECT RELEASE_LOCK(?) AS released", [lockName]);
        if (Number(released[0]?.released) !== 1) throw new Error("Could not release cleanup lock");
      }
    } catch (error) {
      reusable = false;
      logger.error({ worker: "history-retention", err: error }, "Discarding cleanup connection after session cleanup failure");
      connection.destroy();
    }
    if (reusable) connection.release();
  }
}
