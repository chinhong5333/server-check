import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import type { AppConfig } from "./config.js";
import { getPool } from "./db.js";

interface MigrationRow extends RowDataPacket {
  migration_name: string;
  checksum: string;
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function runMigrations(config: AppConfig): Promise<void> {
  const pool = getPool(config);
  const connection = await pool.getConnection();
  const lockName = `server-check-migrations-${config.database.name}`;
  const now = Date.now();

  try {
    const [lockRows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, 30) AS acquired", [
      lockName
    ]);
    if (Number(lockRows[0]?.acquired) !== 1) {
      throw new Error("Could not acquire the database migration lock.");
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        migration_name VARCHAR(255) NOT NULL,
        checksum CHAR(64) NOT NULL,
        applied_at BIGINT UNSIGNED NOT NULL,
        created_at BIGINT UNSIGNED NOT NULL,
        updated_at BIGINT UNSIGNED NOT NULL,
        is_delete TINYINT(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uq_schema_migrations_name (migration_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const migrationsDirectory = path.resolve(process.cwd(), "migrations");
    const filenames = (await readdir(migrationsDirectory))
      .filter((filename) => /^\d+_.+\.sql$/.test(filename))
      .sort();

    for (const filename of filenames) {
      const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const [rows] = await connection.execute<MigrationRow[]>(
        "SELECT migration_name, checksum FROM schema_migrations WHERE migration_name = ? AND is_delete = 0",
        [filename]
      );

      if (rows[0]) {
        if (rows[0].checksum !== checksum) {
          throw new Error(`Migration ${filename} changed after it was applied.`);
        }
        continue;
      }

      for (const statement of splitStatements(sql)) {
        await connection.query(statement);
      }

      await connection.execute(
        `INSERT INTO schema_migrations
          (migration_name, checksum, applied_at, created_at, updated_at, is_delete)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [filename, checksum, now, now, now]
      );
    }
  } finally {
    try {
      await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
    } finally {
      connection.release();
    }
  }
}
