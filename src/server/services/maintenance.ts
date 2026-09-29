import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { MaintenanceIndicator, MaintenanceState, MaintenanceWindow } from "../../shared/contracts.js";
import { AppError } from "../errors.js";

export interface MaintenanceRow extends RowDataPacket {
  id: string;
  public_id: string;
  project_id: string;
  agent_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string;
  ended_at: string | null;
  activated_at: string | null;
  completed_at: string | null;
}

/** Active wins over scheduled; project scope wins ties to identify inherited maintenance. */
export function preferredMaintenance(left: MaintenanceIndicator | null, right: MaintenanceIndicator | null): MaintenanceIndicator | null {
  if (!left) return right;
  if (!right) return left;
  if (left.status !== right.status) return left.status === "active" ? left : right;
  return left.scope === "project" ? left : right;
}

/**
 * Reads list indicators in one query, without one request per project or agent.
 * @param {Pool|PoolConnection} connection Configured application database connection.
 * @param {string[]} projectIds Internal IDs of already-authorized active projects.
 * @param {number} now Server Unix milliseconds; ended, expired and deleted windows are excluded.
 * @returns {Promise<{projects: Map<string, MaintenanceIndicator>, inherited: Map<string, MaintenanceIndicator>, agents: Map<string, MaintenanceIndicator>}>} Effective project summaries, project-only inheritance and agent-only windows.
 */
export async function readMaintenanceIndicators(connection: Pool | PoolConnection, projectIds: string[], now: number) {
  const projects = new Map<string, MaintenanceIndicator>(), inherited = new Map<string, MaintenanceIndicator>(), agents = new Map<string, MaintenanceIndicator>();
  if (!projectIds.length) return { projects, inherited, agents };
  const [rows] = await connection.execute<MaintenanceRow[]>(
    `SELECT w.project_id, w.agent_id, w.starts_at FROM maintenance_windows w
     LEFT JOIN agents a ON a.id = w.agent_id
     WHERE w.project_id IN (${projectIds.map(() => "?").join(",")}) AND w.is_delete = 0
       AND w.ended_at IS NULL AND w.ends_at > ? AND (w.agent_id IS NULL OR a.is_delete = 0)`, [...projectIds, now]);
  for (const row of rows) {
    const projectId = String(row.project_id);
    const indicator: MaintenanceIndicator = { status: Number(row.starts_at) <= now ? "active" : "scheduled", scope: row.agent_id === null ? "project" : "agent" };
    projects.set(projectId, preferredMaintenance(projects.get(projectId) ?? null, indicator)!);
    const target = row.agent_id === null ? inherited : agents, id = row.agent_id === null ? projectId : String(row.agent_id);
    target.set(id, preferredMaintenance(target.get(id) ?? null, indicator)!);
  }
  return { projects, inherited, agents };
}

/** Resolves canonical public scope IDs; mutations lock project first, then its active agents. */
export async function maintenanceTarget(connection: Pool | PoolConnection, projectPublicId: string, agentPublicId?: string, lock = false) {
  const [projects] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM projects WHERE public_id = ? AND is_delete = 0${lock ? " FOR UPDATE" : ""}`, [projectPublicId]);
  if (!projects[0]) throw new AppError(404, "project_not_found", "The selected project does not exist.");
  const projectId = String(projects[0].id);
  const [agents] = await connection.execute<RowDataPacket[]>(
    `SELECT id, public_id, server_name FROM agents WHERE project_id = ? AND is_delete = 0${agentPublicId ? " AND public_id = ?" : ""} ORDER BY id${lock ? " FOR UPDATE" : ""}`,
    agentPublicId ? [projectId, agentPublicId] : [projectId]);
  if (agentPublicId && !agents[0]) throw new AppError(404, "agent_not_found", "The selected agent does not exist in this project.");
  return { projectId, agentId: agentPublicId ? String(agents[0].id) : null, agents };
}

function windowSummary(row: MaintenanceRow, now: number): MaintenanceWindow {
  return { id: row.public_id, scope: row.agent_id === null ? "project" : "agent", starts_at: Number(row.starts_at),
    ends_at: Number(row.ends_at), reason: row.reason, status: Number(row.starts_at) <= now ? "active" : "scheduled" };
}

/** Reads only the target's current/upcoming window and optional inherited project window. */
export async function readMaintenanceState(connection: Pool | PoolConnection, projectId: string, agentId: string | null, now: number): Promise<MaintenanceState> {
  const [rows] = await connection.execute<MaintenanceRow[]>(
    `SELECT * FROM maintenance_windows WHERE project_id = ? AND is_delete = 0 AND ended_at IS NULL AND ends_at > ?
     AND (agent_id IS NULL${agentId === null ? "" : " OR agent_id = ?"}) ORDER BY starts_at, id`,
    agentId === null ? [projectId, now] : [projectId, now, agentId]);
  const own = rows.find(row => agentId === null ? row.agent_id === null : String(row.agent_id) === agentId);
  const inherited = agentId === null ? undefined : rows.find(row => row.agent_id === null);
  return { own: own ? windowSummary(own, now) : null, inherited: inherited ? windowSummary(inherited, now) : null, server_time: now };
}

/** Checks both project and agent windows at the exact delivery/collection boundary. */
export async function agentInMaintenance(connection: PoolConnection, agentId: string, now: number): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT w.id FROM maintenance_windows w INNER JOIN agents a ON a.project_id = w.project_id
     WHERE a.id = ? AND a.is_delete = 0 AND w.is_delete = 0 AND w.ended_at IS NULL
       AND (w.agent_id IS NULL OR w.agent_id = a.id) AND w.starts_at <= ? AND w.ends_at > ? LIMIT 1`, [agentId, now, now]);
  return rows.length > 0;
}

/** Holds delivery at expiry until stale messages have been cancelled and current incidents reseeded. */
export async function agentAwaitingMaintenanceResume(connection: PoolConnection, agentId: string, now: number): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT w.id FROM maintenance_windows w INNER JOIN agents a ON a.project_id = w.project_id
     WHERE a.id = ? AND w.is_delete = 0 AND w.completed_at IS NULL AND w.starts_at <= ?
       AND (w.agent_id IS NULL OR w.agent_id = a.id) AND (w.ends_at <= ? OR w.ended_at IS NOT NULL)
       AND (w.ended_at IS NULL OR w.ended_at > w.starts_at) LIMIT 1`, [agentId, now, now]);
  return rows.length > 0;
}

/** Preserves suppressed deliveries as cancelled logs, without retrying or changing incident state. */
export async function cancelMaintenanceNotifications(connection: PoolConnection, agentId: string, now: number, cutoff = Number.MAX_SAFE_INTEGER): Promise<void> {
  await connection.execute(
    `UPDATE notification_outbox o INNER JOIN incidents i ON i.id = o.incident_id
     SET o.status = 'cancelled', o.last_error = 'Suppressed during maintenance', o.updated_at = ?
     WHERE i.agent_id = ? AND o.channel = 'telegram' AND o.status = 'pending' AND o.is_delete = 0 AND o.created_at <= ?`,
    [now, agentId, cutoff]);
}
