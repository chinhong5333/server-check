import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeTestDatabase, loadConfig, type AppConfig } from "../../src/server/config.js";
import { closePool, getPool, verifyDatabaseConnection } from "../../src/server/db.js";
import { runMigrations } from "../../src/server/migrations.js";

interface VersionRow extends RowDataPacket {
  version: string;
}

interface TableRow extends RowDataPacket {
  table_name: string;
}

describe("dedicated local MySQL integration", () => {
  let config: AppConfig;

  beforeAll(async () => {
    config = loadConfig();
    assertSafeTestDatabase(config);
    await verifyDatabaseConnection(config);
    const [versionRows] = await getPool(config).query<VersionRow[]>("SELECT VERSION() AS version");
    const version = versionRows[0]?.version ?? "";
    if (version.toLowerCase().includes("mariadb")) {
      throw new Error("Database integration requires local MySQL; MariaDB is not a substitute.");
    }
    const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
    if (major < 8) throw new Error("Database integration requires MySQL 8 or newer.");
    await runMigrations(config);
  });

  afterAll(async () => {
    await closePool();
  });

  it("creates the complete schema in the isolated test database", async () => {
    const [rows] = await getPool(config).execute<TableRow[]>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = ?`,
      [config.database.name]
    );
    const names = new Set(rows.map((row) => row.table_name));
    for (const required of [
      "projects",
      "internal_users",
      "user_sessions",
      "agents",
      "heartbeat_events",
      "metric_samples",
      "filesystem_samples",
      "service_check_samples",
      "incidents",
      "notification_outbox",
      "audit_events"
    ]) {
      expect(names.has(required), `${required} must exist`).toBe(true);
    }
  });

  it("persists and rolls back a synthetic project using real MySQL behavior", async () => {
    const connection = await getPool(config).getConnection();
    const now = Date.now();
    await connection.beginTransaction();
    try {
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO projects
          (public_id, name, slug, ram_available_threshold_percent,
           disk_available_threshold_percent, load_5_per_core_threshold,
           heartbeat_interval_seconds, heartbeat_grace_seconds,
           created_at, updated_at, is_delete)
         VALUES ('00000000-0000-4000-8000-000000000001', 'Synthetic integration project',
                 'synthetic-integration-project', 15, 10, 1.5, 60, 0, ?, ?, 0)`,
        [now, now]
      );
      expect(result.affectedRows).toBe(1);
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT name FROM projects WHERE public_id = '00000000-0000-4000-8000-000000000001'"
      );
      expect(rows[0]?.name).toBe("Synthetic integration project");
    } finally {
      await connection.rollback();
      connection.release();
    }
  });
});
