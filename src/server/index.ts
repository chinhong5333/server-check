import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { closePool, verifyDatabaseConnection } from "./db.js";
import { startWorkers } from "./workers.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await verifyDatabaseConnection(config);
  const { app, logger } = createApp(config);
  const server = createServer(app);
  const stopWorkers = startWorkers(config, logger);

  server.listen(config.port, config.host, () => {
    logger.info(
      { host: config.host, port: config.port, environment: config.nodeEnv },
      "Server Check is listening"
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down Server Check");
    stopWorkers();
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
