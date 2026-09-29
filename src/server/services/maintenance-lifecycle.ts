import type { RowDataPacket } from "mysql2/promise";
import type { AppConfig } from "../config.js";
import { getPool, withTransaction } from "../db.js";
import { queueTelegramNotification } from "./alert-queue.js";
import { agentInMaintenance, cancelMaintenanceNotifications, type MaintenanceRow } from "./maintenance.js";

/**
 * Applies persisted start/end transitions once; never replays a pre-maintenance delivery.
 * @param {AppConfig} config Configured database connection.
 * @param {number} [now=Date.now()] Server Unix milliseconds used for the transition boundary.
 * @returns {Promise<void>} Resolves after locked, idempotent scope transitions and fresh alert collection.
 */
export async function processMaintenanceWindows(config: AppConfig, now = Date.now()): Promise<void> {
  const [candidates] = await getPool(config).execute<RowDataPacket[]>(
    `SELECT DISTINCT w.project_id FROM maintenance_windows w INNER JOIN projects p ON p.id = w.project_id
     WHERE w.is_delete = 0 AND p.is_delete = 0 AND w.completed_at IS NULL
       AND ((w.activated_at IS NULL AND w.starts_at <= ?) OR w.ends_at <= ? OR w.ended_at IS NOT NULL)
     ORDER BY w.project_id`, [now, now]);
  for (const candidate of candidates) {
    await withTransaction(config, async connection => {
      const [projects] = await connection.execute<RowDataPacket[]>(
        "SELECT id, name FROM projects WHERE id = ? AND is_delete = 0 FOR UPDATE", [candidate.project_id]);
      if (!projects[0]) return;
      const [agents] = await connection.execute<RowDataPacket[]>(
        "SELECT id, public_id, server_name FROM agents WHERE project_id = ? AND is_delete = 0 ORDER BY id FOR UPDATE", [candidate.project_id]);
      const [windows] = await connection.execute<MaintenanceRow[]>(
        `SELECT * FROM maintenance_windows WHERE project_id = ? AND is_delete = 0 AND completed_at IS NULL
         AND ((activated_at IS NULL AND starts_at <= ?) OR ends_at <= ? OR ended_at IS NOT NULL) ORDER BY id FOR UPDATE`,
        [candidate.project_id, now, now]);
      const resume = new Set<string>();
      for (const window of windows) {
        const affected = agents.filter(agent => window.agent_id === null || String(agent.id) === String(window.agent_id));
        if (window.ended_at === null && now < Number(window.ends_at)) {
          for (const agent of affected) await cancelMaintenanceNotifications(connection, String(agent.id), now);
          await connection.execute("UPDATE maintenance_windows SET activated_at = ?, updated_at = ? WHERE id = ?", [now, now, window.id]);
          continue;
        }
        const end = Math.min(Number(window.ends_at), window.ended_at === null ? Number(window.ends_at) : Number(window.ended_at));
        if (end > Number(window.starts_at) && now >= Number(window.starts_at)) {
          for (const agent of affected) {
            await cancelMaintenanceNotifications(connection, String(agent.id), now, end - 1);
            resume.add(String(agent.id));
          }
        }
        await connection.execute("UPDATE maintenance_windows SET completed_at = ?, updated_at = ? WHERE id = ?", [now, now, window.id]);
      }
      for (const agent of agents) {
        if (!resume.has(String(agent.id)) || await agentInMaintenance(connection, String(agent.id), now)) continue;
        const [incidents] = await connection.execute<RowDataPacket[]>(
          "SELECT id, public_id, incident_type, severity, probable_cause, details_json FROM incidents WHERE agent_id = ? AND status = 'open' AND is_delete = 0 ORDER BY id", [agent.id]);
        for (const incident of incidents) {
          let details: unknown = incident.details_json;
          if (typeof details === "string") { try { details = JSON.parse(details); } catch { details = {}; } }
          await queueTelegramNotification(connection, String(candidate.project_id), incident.id, "opened", {
            incident_id: incident.public_id, incident_type: incident.incident_type, project_name: projects[0].name,
            agent_id: agent.public_id, server_name: agent.server_name, severity: incident.severity,
            probable_cause: incident.probable_cause, details, observed_at: now
          }, now);
        }
      }
    });
  }
}
