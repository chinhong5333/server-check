import type { PoolConnection, RowDataPacket } from "mysql2/promise";

// One shared destination: >3 seconds between attempts keeps all message types below 20/minute.
export const TELEGRAM_MIN_DELIVERY_GAP_MS = 3100;

/**
 * Locks the shared transport limiter across worker processes. The caller keeps this lock through delivery.
 * @param {PoolConnection} connection Caller-owned delivery transaction.
 * @param {number} now Server Unix timestamp in milliseconds.
 * @returns {Promise<RowDataPacket>} Persisted delivery and flood-control deadlines.
 */
export async function lockTelegramDelivery(connection: PoolConnection, now: number): Promise<RowDataPacket> {
  await connection.execute(
    `INSERT INTO telegram_delivery_state (scope_key, next_delivery_at, blocked_until, created_at, updated_at, is_delete)
     VALUES ('platform', 0, 0, ?, ?, 0) ON DUPLICATE KEY UPDATE scope_key = scope_key`, [now, now]);
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT next_delivery_at, blocked_until FROM telegram_delivery_state WHERE scope_key = 'platform' AND is_delete = 0 FOR UPDATE");
  if (!rows[0]) throw new Error("The shared Telegram delivery state is unavailable.");
  return rows[0];
}
