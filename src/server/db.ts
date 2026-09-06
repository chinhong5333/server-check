import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket
} from "mysql2/promise";
import type { AppConfig } from "./config.js";

let pool: Pool | null = null;

export function getPool(config: AppConfig): Pool {
  if (pool) return pool;

  pool = mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    connectionLimit: config.database.connectionLimit,
    enableKeepAlive: true,
    waitForConnections: true,
    queueLimit: 0,
    charset: "utf8mb4",
    supportBigNumbers: true,
    bigNumberStrings: true,
    namedPlaceholders: false
  });

  return pool;
}

export async function withTransaction<T>(
  config: AppConfig,
  operation: (connection: PoolConnection) => Promise<T>
): Promise<T> {
  const connection = await getPool(config).getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function verifyDatabaseConnection(config: AppConfig): Promise<void> {
  const connection = await getPool(config).getConnection();
  try {
    await connection.execute<RowDataPacket[]>("SELECT 1 AS ok");
  } finally {
    connection.release();
  }
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}

export type { ResultSetHeader, RowDataPacket };
