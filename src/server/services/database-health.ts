export interface DatabaseHealth {
  status: "alive" | "fail";
  message: string;
  connection_count: number | null;
  connection_max: number | null;
  threads_running: number | null;
  peak_connections: number | null;
  long_queries: number | null;
  db_size_mb: string | null;
  fragmented_mb: string | null;
}

type Row = Record<string, unknown>;
type Query = (sql: string) => Promise<Row[]>;

const PROBE_TIMEOUT_MS = 2000;
const SIZE_CACHE_MS = 60000;
const LONG_QUERY_SECONDS = 5;

const emptyMetrics = {
  connection_count: null,
  connection_max: null,
  threads_running: null,
  peak_connections: null,
  long_queries: null,
  db_size_mb: null,
  fragmented_mb: null
};

function count(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function size(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${PROBE_TIMEOUT_MS}ms`)), PROBE_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeMessage(error: unknown, label: string): string {
  return error instanceof Error && error.message === `${label} timeout after ${PROBE_TIMEOUT_MS}ms`
    ? error.message
    : `${label} unavailable`;
}

/**
 * Builds one read-only probe with a per-process size cache and concurrent-request deduplication.
 * @param {Query} query SQL executor for the configured MySQL pool.
 * @param {(message: string) => void} [onError] Reporter for sanitized probe failures.
 * @returns {() => Promise<DatabaseHealth>} Database health lookup.
 */
export function createDatabaseHealthProbe(query: Query, onError?: (message: string) => void): () => Promise<DatabaseHealth> {
  let sizeCache: { at: number; value: Pick<DatabaseHealth, "db_size_mb" | "fragmented_mb"> } | null = null;
  let inFlight: Promise<DatabaseHealth> | null = null;

  async function readSize() {
    if (sizeCache && Date.now() - sizeCache.at < SIZE_CACHE_MS) return sizeCache.value;
    const rows = await withTimeout(query(
      "SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 1) AS size_mb, " +
      "ROUND(SUM(data_free) / 1024 / 1024, 1) AS free_mb " +
      "FROM information_schema.tables WHERE table_schema = DATABASE()"
    ), "db size");
    const value = { db_size_mb: size(rows[0]?.size_mb), fragmented_mb: size(rows[0]?.free_mb) };
    sizeCache = { at: Date.now(), value };
    return value;
  }

  async function probe(): Promise<DatabaseHealth> {
    try {
      await withTimeout(query("SELECT 1"), "db probe");
    } catch (error) {
      const message = safeMessage(error, "db probe");
      onError?.(message);
      return { status: "fail", message, ...emptyMetrics };
    }

    try {
      const [statuses, limitRows, longQueryRows, databaseSize] = await Promise.all([
        withTimeout(query("SHOW STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Max_used_connections')"), "db metrics"),
        withTimeout(query("SHOW VARIABLES LIKE 'max_connections'"), "db metrics"),
        withTimeout(query("SELECT COUNT(*) AS n FROM information_schema.processlist WHERE COMMAND != 'Sleep' AND TIME > " + LONG_QUERY_SECONDS), "db long queries"),
        readSize()
      ]);
      const status = new Map(statuses.map(row => [String(row.Variable_name), row.Value]));
      return {
        status: "alive",
        message: "",
        connection_count: count(status.get("Threads_connected")),
        connection_max: count(limitRows[0]?.Value),
        threads_running: count(status.get("Threads_running")),
        peak_connections: count(status.get("Max_used_connections")),
        long_queries: count(longQueryRows[0]?.n),
        ...databaseSize
      };
    } catch (error) {
      const message = `metrics unavailable: ${safeMessage(error, "db metrics")}`;
      onError?.(message);
      return { status: "alive", message, ...emptyMetrics };
    }
  }

  return () => {
    if (!inFlight) inFlight = probe().finally(() => { inFlight = null; });
    return inFlight;
  };
}
