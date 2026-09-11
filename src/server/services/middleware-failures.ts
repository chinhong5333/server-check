import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { AppError } from "../errors.js";

/**
 * Advances the persistent streak for one unique, validated middleware result.
 * @param {PoolConnection} connection Existing heartbeat transaction; locks the agent before updating.
 * @param {string} agentId Internal agent ID.
 * @param {"healthy"|"unhealthy"|"disabled"} outcome Validated middleware outcome. Healthy/disabled clears the streak.
 * @returns {Promise<{count: number, threshold: number}>} Current streak and saved alert threshold.
 */
export async function advanceMiddlewareFailures(connection: PoolConnection, agentId: string, outcome: "healthy" | "unhealthy" | "disabled") {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT middleware_failure_threshold, middleware_failure_count FROM agents WHERE id = ? AND is_delete = 0 FOR UPDATE", [agentId]);
  if (!rows[0]) throw new AppError(404,"agent_not_found","The selected agent no longer exists.");
  const threshold = Number(rows[0].middleware_failure_threshold);
  const previous = Number(rows[0].middleware_failure_count);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 10 || !Number.isSafeInteger(previous) || previous < 0) {
    throw new AppError(500,"invalid_monitoring_configuration","The middleware failure policy is invalid.");
  }
  const count = outcome === "unhealthy" ? Math.min(previous + 1, 2147483647) : 0;
  if (count !== previous) {
    await connection.execute("UPDATE agents SET middleware_failure_count = ? WHERE id = ?", [count, agentId]);
  }
  return { count, threshold };
}
