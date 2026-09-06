import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { DEFAULT_HEALTH_REQUEST_TIMEOUT_SECONDS } from "../src/shared/contracts.js";
import { loadConfig } from "../src/server/config.js";
import { closePool, getPool, withTransaction } from "../src/server/db.js";
import { createAgentCredential } from "../src/server/security/crypto.js";
import {
  APACHE_AUTO_DETECT_LABEL,
  generateAgentScript
} from "../src/server/services/agent-script.js";

const runtimeDirectory = path.resolve(".runtime");
const fixturePath = path.join(runtimeDirectory, "wsl-test-fixture.json");
const scriptPath = path.join(runtimeDirectory, "server-check-wsl-local-pc.sh");

interface FixtureRecord {
  project_id: string;
  project_name: string;
  agent_id: string;
  agent_name: string;
  script_path: string;
}

interface StatusRow extends RowDataPacket {
  project_name: string;
  server_name: string;
  status: string;
  probable_cause: string | null;
  agent_version: string | null;
  last_heartbeat_at: string | null;
  last_metrics_at: string | null;
  ram_available_percent: string | null;
  disk_available_percent: string | null;
  load_5_per_core: string | null;
  health_outcome: string | null;
  health_http_status_code: number | null;
}

async function showStatus(): Promise<void> {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as FixtureRecord;
  const config = loadConfig();
  const [rows] = await getPool(config).execute<StatusRow[]>(
    `SELECT p.name AS project_name, a.server_name, a.status, a.probable_cause,
            a.agent_version, a.last_heartbeat_at, a.last_metrics_at,
            a.last_ram_available_percent AS ram_available_percent,
            a.last_disk_available_percent AS disk_available_percent,
            a.last_load_5_per_core AS load_5_per_core,
            a.last_health_outcome AS health_outcome,
            a.last_health_http_status_code AS health_http_status_code
     FROM agents a
     INNER JOIN projects p ON p.id = a.project_id
     WHERE p.public_id = ? AND a.public_id = ? AND p.is_delete = 0 AND a.is_delete = 0
     LIMIT 1`,
    [fixture.project_id, fixture.agent_id]
  );
  if (!rows[0]) throw new Error("The WSL test fixture is missing.");
  process.stdout.write(`${JSON.stringify(rows[0], null, 2)}\n`);
}

async function createFixture(): Promise<void> {
  const config = loadConfig();
  const projectPublicId = randomUUID();
  const agentPublicId = randomUUID();
  const credential = createAgentCredential(agentPublicId);
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const projectName = `WSL Local Test ${timestamp}`;
  const agentName = "wsl-local-pc";
  const slug = `wsl-local-test-${projectPublicId.slice(0, 8)}`;
  const now = Date.now();
  const centralApiUrl = new URL("/api/v1/agent/heartbeats", config.publicBaseUrl).toString();
  const healthApiUrl = new URL("/api/v1/health/live", config.publicBaseUrl).toString();

  await withTransaction(config, async (connection) => {
    const [projectResult] = await connection.execute(
      `INSERT INTO projects
        (public_id, name, slug, ram_available_threshold_percent,
         disk_available_threshold_percent, load_5_per_core_threshold,
         heartbeat_interval_seconds, heartbeat_grace_seconds,
         created_at, updated_at, is_delete)
       VALUES (?, ?, ?, 5, 5, 10, 120, 0, ?, ?, 0)`,
      [projectPublicId, projectName, slug, now, now]
    );
    const projectInternalId = String((projectResult as { insertId: number }).insertId);
    await connection.execute(
      `INSERT INTO agents
        (public_id, project_id, server_name, health_api_url,
         health_request_timeout_seconds, ram_available_threshold_percent,
         disk_available_threshold_percent, load_5_per_core_threshold,
         heartbeat_interval_seconds, apache_service_name,
         credential_hash, credential_hint, status, probable_cause,
         agent_version, last_heartbeat_at, last_metrics_at, last_validation_error,
         last_ram_available_percent, last_disk_available_percent,
         last_load_5_per_core, last_health_outcome,
         last_health_http_status_code, last_health_latency_ms,
         created_at, updated_at, is_delete)
       VALUES (?, ?, ?, ?, ?, 5, 5, 10, 120, ?, ?, ?, 'new', 'Awaiting first heartbeat',
               NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, 0)`,
      [
        agentPublicId,
        projectInternalId,
        agentName,
        healthApiUrl,
        DEFAULT_HEALTH_REQUEST_TIMEOUT_SECONDS,
        APACHE_AUTO_DETECT_LABEL,
        credential.credentialHash,
        credential.credentialHint,
        now,
        now
      ]
    );
  });

  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(
    scriptPath,
    generateAgentScript({
      agentId: agentPublicId,
      projectName,
      agentName,
      credential: credential.credential,
      centralApiUrl,
      healthApiUrl,
      healthRequestTimeoutSeconds: DEFAULT_HEALTH_REQUEST_TIMEOUT_SECONDS
    }),
    { encoding: "utf8", mode: 0o700 }
  );
  const fixture: FixtureRecord = {
    project_id: projectPublicId,
    project_name: projectName,
    agent_id: agentPublicId,
    agent_name: agentName,
    script_path: scriptPath
  };
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(fixture, null, 2)}\n`);
}

try {
  if (process.argv.includes("--status")) await showStatus();
  else await createFixture();
} finally {
  await closePool();
}
