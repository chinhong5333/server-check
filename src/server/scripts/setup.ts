import { loadConfig } from "../config.js";
import { closePool, verifyDatabaseConnection } from "../db.js";
import { runMigrations } from "../migrations.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await verifyDatabaseConnection(config);
  await runMigrations(config);
  process.stdout.write("Server Check database setup completed.\n");
  process.stdout.write("Run npm run create-admin to create an internal administrator.\n");
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
