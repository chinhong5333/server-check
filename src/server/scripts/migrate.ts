import { closePool, verifyDatabaseConnection } from "../db.js";
import { loadConfig } from "../config.js";
import { runMigrations } from "../migrations.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await verifyDatabaseConnection(config);
  await runMigrations(config);
  process.stdout.write("Database migrations are current.\n");
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
