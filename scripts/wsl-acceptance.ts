import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { loadConfig } from "../src/server/config.js";
import { closePool, getPool, withTransaction } from "../src/server/db.js";
import { createAgentCredential } from "../src/server/security/crypto.js";
import { generateAgentScript } from "../src/server/services/agent-script.js";
import type { AgentChecks } from "../src/shared/contracts.js";

interface Case { name: string; checks: AgentChecks; url: string | null; interval: number; agent_id?: string; }
interface Manifest { project_id: string; project_name: string; private_directory: string; wsl_directory: string; report_directory: string; cases: Case[]; }
const config = loadConfig();
const cases: Case[] = [
  { name: "01-web-servers-unavailable", checks: { apache: true, nginx: true, middleware_api: false }, url: null, interval: 3600 },
  { name: "02-middleware-healthy", checks: { apache: false, nginx: false, middleware_api: true }, url: "http://127.0.0.1:18082/health", interval: 3600 },
  { name: "03-middleware-http-503", checks: { apache: false, nginx: false, middleware_api: true }, url: "http://127.0.0.1:18082/error", interval: 3600 },
  { name: "04-middleware-refused", checks: { apache: false, nginx: false, middleware_api: true }, url: "http://127.0.0.1:18089/health", interval: 3600 },
  { name: "05-middleware-timeout", checks: { apache: false, nginx: false, middleware_api: true }, url: "http://127.0.0.1:18082/slow", interval: 3600 },
  { name: "06-all-checks-disabled", checks: { apache: false, nginx: false, middleware_api: false }, url: null, interval: 3600 },
  { name: "07-apache-running", checks: { apache: true, nginx: false, middleware_api: false }, url: null, interval: 3600 },
  { name: "08-apache-stopped", checks: { apache: true, nginx: false, middleware_api: false }, url: null, interval: 3600 },
  { name: "09-nginx-running", checks: { apache: false, nginx: true, middleware_api: false }, url: null, interval: 3600 },
  { name: "10-nginx-stopped", checks: { apache: false, nginx: true, middleware_api: false }, url: null, interval: 3600 },
  { name: "11-nginx-recovery", checks: { apache: false, nginx: true, middleware_api: false }, url: null, interval: 3600 },
  { name: "12-heartbeat-overdue", checks: { apache: false, nginx: false, middleware_api: false }, url: null, interval: 60 },
  { name: "13-all-enabled-healthy", checks: { apache: true, nginx: true, middleware_api: true }, url: "http://127.0.0.1:18082/health", interval: 3600 }
];

async function prepare() {
  if (config.database.host !== "127.0.0.1") throw new Error("This acceptance fixture requires the explicitly selected local runtime.");
  const [telegram] = await getPool(config).query<RowDataPacket[]>("SELECT telegram_bot_token_encrypted IS NOT NULL AS configured FROM platform_telegram_settings WHERE is_delete=0");
  if (telegram.some(row => Number(row.configured) === 1)) throw new Error("Telegram is configured; stop before creating test alerts without send authorization.");
  const id = randomUUID();
  const name = `WSL Acceptance ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`;
  const privateDirectory = path.join(tmpdir(), `server-check-wsl-${id}`);
  const reportDirectory = path.resolve("output", `wsl-acceptance-${id}`);
  const wslDirectory = `/var/tmp/server-check-acceptance-${id}`;
  await mkdir(privateDirectory, { mode: 0o700 });
  await mkdir(reportDirectory, { recursive: true });
  const now = Date.now();
  await withTransaction(config, async connection => {
    const [project] = await connection.execute<ResultSetHeader>(`INSERT INTO projects
      (public_id,name,slug,ram_available_threshold_percent,disk_available_threshold_percent,load_5_per_core_threshold,
       heartbeat_interval_seconds,heartbeat_grace_seconds,created_at,updated_at,is_delete)
      VALUES (?,?,?,0.1,0.1,100,3600,0,?,?,0)`, [id,name,`wsl-acceptance-${id}`,now,now]);
    for (const item of cases) {
      item.agent_id = randomUUID();
      const credential = createAgentCredential(item.agent_id);
      await connection.execute(`INSERT INTO agents
        (public_id,project_id,server_name,health_api_url,check_configuration_json,health_request_timeout_seconds,
         apache_service_name,credential_hash,credential_hint,ram_available_threshold_percent,disk_available_threshold_percent,
         load_5_per_core_threshold,heartbeat_interval_seconds,telegram_alert_cooldown_seconds,created_at,updated_at,is_delete)
        VALUES (?,?,?,?,?,1,'auto-detect',?,?,0.1,0.1,100,?,3600,?,?,0)`,
        [item.agent_id,project.insertId,item.name,item.url,JSON.stringify(item.checks),credential.credentialHash,
          credential.credentialHint,item.interval,now,now]);
      const script = generateAgentScript({ agentId: item.agent_id, projectName: name, agentName: item.name,
        credential: credential.credential, centralApiUrl: "http://172.27.112.1:3000/api/v1/agent/heartbeats",
        healthApiUrl: item.url, healthRequestTimeoutSeconds: 1, checks: item.checks });
      await writeFile(path.join(privateDirectory, `${item.name}.sh`), script, { flag: "wx", mode: 0o700 });
    }
  });
  const manifest: Manifest = { project_id: id, project_name: name, private_directory: privateDirectory,
    wsl_directory: wslDirectory, report_directory: reportDirectory, cases };
  const files: Record<string,string> = {
    "nginx.conf": `daemon off;\nworker_processes 1;\npid ${wslDirectory}/nginx.pid;\nerror_log ${wslDirectory}/nginx-error.log;\nevents { worker_connections 64; }\nhttp { client_body_temp_path ${wslDirectory}/nginx-body; proxy_temp_path ${wslDirectory}/nginx-proxy; fastcgi_temp_path ${wslDirectory}/nginx-fastcgi; uwsgi_temp_path ${wslDirectory}/nginx-uwsgi; scgi_temp_path ${wslDirectory}/nginx-scgi; access_log ${wslDirectory}/nginx-access.log; server { listen 127.0.0.1:18081; location / { return 200 'Real Nginx WSL acceptance server'; } } }\n`,
    "apache.conf": `ServerRoot "${wslDirectory}/packages/usr/lib/apache2"\nPidFile "${wslDirectory}/apache.pid"\nListen 127.0.0.1:18080\nServerName localhost\nLoadModule mpm_event_module "${wslDirectory}/packages/usr/lib/apache2/modules/mod_mpm_event.so"\nLoadModule authz_core_module "${wslDirectory}/packages/usr/lib/apache2/modules/mod_authz_core.so"\nUser www-data\nGroup www-data\nErrorLog "${wslDirectory}/apache-error.log"\nDocumentRoot "${wslDirectory}/public"\n<Directory "${wslDirectory}/public">\nRequire all granted\n</Directory>\n`,
    "nginx.service": `[Unit]\nDescription=Server Check WSL Acceptance - Real Nginx\n[Service]\nType=simple\nEnvironment=LD_LIBRARY_PATH=${wslDirectory}/packages/usr/lib/x86_64-linux-gnu\nExecStart=${wslDirectory}/packages/usr/sbin/nginx -c ${wslDirectory}/nginx.conf\nKillSignal=SIGQUIT\n`,
    "apache2.service": `[Unit]\nDescription=Server Check WSL Acceptance - Real Apache\n[Service]\nType=simple\nEnvironment=LD_LIBRARY_PATH=${wslDirectory}/packages/usr/lib/x86_64-linux-gnu\nExecStart=${wslDirectory}/packages/usr/sbin/apache2 -f ${wslDirectory}/apache.conf -DFOREGROUND\nKillSignal=SIGWINCH\n`,
    "middleware.service": `[Unit]\nDescription=Server Check WSL Acceptance Middleware\n[Service]\nType=simple\nExecStart=/usr/bin/python3 ${wslDirectory}/middleware.py\n`,
    "middleware.py": `from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer\nimport time\nclass Handler(BaseHTTPRequestHandler):\n    def do_GET(self):\n        if self.path == '/slow': time.sleep(3)\n        self.send_response(503 if self.path == '/error' else 200)\n        self.send_header('Content-Type', 'application/json')\n        self.end_headers()\n        try: self.wfile.write(b'{"source":"WSL acceptance middleware"}')\n        except BrokenPipeError: pass\nThreadingHTTPServer(('127.0.0.1', 18082), Handler).serve_forever()\n`,
    "index.html": "Real Apache WSL acceptance server\n"
  };
  for(const [filename,contents] of Object.entries(files)) await writeFile(path.join(privateDirectory,filename),contents,{flag:"wx"});
  const manifestPath = path.join(reportDirectory,"manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest,null,2), {flag:"wx"});
  console.log(JSON.stringify({manifest:manifestPath,...manifest},null,2));
}

async function verify(manifestPath: string, caseName: string, expected: string, phase: string, run: boolean) {
  const manifest: Manifest = JSON.parse(await readFile(manifestPath,"utf8"));
  const item=manifest.cases.find(c=>c.name===caseName);
  if(!item) throw new Error("Unknown fixture case");
  if(run) {
    const result=spawnSync("wsl.exe",["-d","Ubuntu","-u","root","--","/bin/sh",`${manifest.wsl_directory}/agents/${caseName}.sh`],{encoding:"utf8",timeout:45000});
    if(result.status!==0) throw new Error(`Agent failed: ${result.stderr || result.stdout || result.error}`);
  }
  const [rows]=await getPool(config).execute<RowDataPacket[]>(`SELECT a.public_id AS agent_id,a.server_name,a.status,a.probable_cause,
    a.agent_version,a.last_heartbeat_at,a.last_metrics_at,a.last_service_checks_json,
    (SELECT COUNT(*) FROM metric_samples m WHERE m.agent_id=a.id) AS samples
    FROM agents a JOIN projects p ON p.id=a.project_id WHERE a.public_id=? AND p.public_id=?`,[item.agent_id,manifest.project_id]);
  const row=rows[0]; if(!row) throw new Error("Fixture missing");
  const [incidents]=await getPool(config).execute<RowDataPacket[]>(`SELECT i.incident_type,i.status,i.probable_cause,i.opened_at,i.resolved_at
    FROM incidents i JOIN agents a ON a.id=i.agent_id WHERE a.public_id=? ORDER BY i.created_at`,[item.agent_id]);
  const record={case:caseName,phase,expected,passed:row.status===expected,checked_at:new Date().toISOString(),...row,
    health:typeof row.last_service_checks_json==="string"?JSON.parse(row.last_service_checks_json):row.last_service_checks_json,incidents};
  delete record.last_service_checks_json;
  const file=path.join(manifest.report_directory,`${caseName}-${phase}.json`);
  await writeFile(file,JSON.stringify(record,null,2),{flag:"wx"});
  console.log(JSON.stringify(record,null,2));
  if(!record.passed) process.exitCode=1;
}

try {
  const [command,manifest,caseName,expected,phase]=process.argv.slice(2);
  if(command==='prepare') await prepare();
  else if((command==='run'||command==='verify')&&manifest&&caseName&&expected&&phase) await verify(manifest,caseName,expected,phase,command==='run');
  else throw new Error("Use prepare, or run/verify <manifest> <case> <expected-status> <phase>");
} finally { await closePool(); }
