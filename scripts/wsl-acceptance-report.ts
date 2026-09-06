import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { loadConfig } from "../src/server/config.js";
import { getPool, closePool } from "../src/server/db.js";

try {
  const manifestPath=process.argv[2];
  if(!manifestPath) throw new Error("Pass the retained fixture manifest path.");
  const manifest=JSON.parse(await readFile(manifestPath,"utf8"));
  const config=loadConfig();
  if(config.database.host!=="127.0.0.1" || !manifest.project_name.startsWith("WSL Acceptance ")) throw new Error("Unexpected fixture target");
  const pool=getPool(config);
  const [projects]=await pool.execute<RowDataPacket[]>("SELECT id,public_id,name,created_at FROM projects WHERE public_id=? AND is_delete=0",[manifest.project_id]);
  if(!projects[0]) throw new Error("Test project missing");
  const project=projects[0];
  const [agents]=await pool.execute<RowDataPacket[]>(`SELECT public_id,server_name,status,probable_cause,health_api_url,check_configuration_json,
    agent_version,heartbeat_interval_seconds,health_request_timeout_seconds,last_heartbeat_at,last_metrics_at,last_service_checks_json
    FROM agents WHERE project_id=? ORDER BY server_name`,[project.id]);
  const data: Record<string,unknown>={project,agents};
  for(const table of ["heartbeat_events","metric_samples","filesystem_samples","service_check_samples","incidents","notification_outbox"]) {
    const [rows]=await pool.execute<RowDataPacket[]>(`SELECT * FROM ${table} WHERE project_id=? ORDER BY id`,[project.id]);
    data[table]=rows;
  }
  const records=[];
  for(const name of await readdir(manifest.report_directory)) {
    if(/^\d\d-.*\.json$/.test(name)) records.push(JSON.parse(await readFile(path.join(manifest.report_directory,name),"utf8")));
  }
  records.sort((a,b)=>a.checked_at.localeCompare(b.checked_at));
  const latest=(prefix:string)=>records.filter(r=>r.case.startsWith(prefix)).at(-1);
  const assertions: [string,boolean][]=[
    ["Absent web servers report Unknown/Warning",latest("01").health.apache.status==="unknown"&&latest("01").health.nginx.status==="unknown"&&latest("01").status==="warning"],
    ["Middleware HTTP 200 is Healthy",latest("02").health.middleware_api.http_status_code===200&&latest("02").status==="healthy"],
    ["Middleware HTTP 503 is Critical",latest("03").health.middleware_api.http_status_code===503&&latest("03").status==="critical"],
    ["Connection refusal is classified",latest("04").health.middleware_api.error_code==="connection_error"],
    ["Timeout is classified",latest("05").health.middleware_api.error_code==="timeout"],
    ["Unchecked probes report Disabled",latest("06").health.apache.status==="disabled"&&latest("06").health.nginx.status==="disabled"&&latest("06").health.middleware_api.outcome==="disabled"],
    ["Running Apache is Healthy",latest("07").health.apache.status==="active"&&latest("07").status==="healthy"],
    ["Stopped Apache is Critical",latest("08").health.apache.status==="inactive"&&latest("08").status==="critical"],
    ["Running Nginx is Healthy",latest("09").health.nginx.status==="active"&&latest("09").status==="healthy"],
    ["Stopped Nginx is Critical",latest("10").health.nginx.status==="inactive"&&latest("10").status==="critical"],
    ["Nginx recovery closes incidents",latest("11").status==="healthy"&&latest("11").incidents.every((i:any)=>i.status==="resolved")],
    ["Heartbeat expires through the real backend worker",latest("12").status==="critical"&&latest("12").incidents.some((i:any)=>i.incident_type==="heartbeat_missed"&&i.status==="open")],
    ["All enabled checks report Healthy together",latest("13").status==="healthy"&&latest("13").health.apache.status==="active"&&latest("13").health.nginx.status==="active"&&latest("13").health.middleware_api.outcome==="healthy"],
    ["Unknown does not falsely resolve an outage",records.some(r=>r.phase==="unknown-after-outage"&&r.status==="critical"&&r.health.nginx.status==="unknown"&&r.incidents.some((i:any)=>i.incident_type==="nginx_inactive"&&i.status==="open"))],
    ["Repeated failures reuse one open incident",latest("03").incidents.filter((i:any)=>i.incident_type==="health_api_unhealthy").length===1&&Number(latest("03").samples)>=2]
  ];
  const outbox=data.notification_outbox as RowDataPacket[];
  const sent=outbox.filter(row=>row.status==="sent").length;
  if(sent!==0) throw new Error("Unexpected Telegram delivery; inspect retained notification records");
  data.observations=records; data.assertions=assertions; data.exported_at=new Date().toISOString();
  await writeFile(path.join(manifest.report_directory,"retained-data.json"),JSON.stringify(data,null,2),{flag:"wx"});
  const lines=["# WSL Monitoring Acceptance Report","",`Project: **${manifest.project_name}**`,"",
    `[Open Test Project](http://localhost:5173/projects/${manifest.project_id})`,"",
    "## Result","",`${assertions.filter(([,pass])=>pass).length}/${assertions.length} final acceptance assertions passed across 13 retained scenario agents. All calls used generated version 1.3.0 shell scripts executed in real Ubuntu WSL, real network requests, the running backend, and its local database. Apache and Nginx were real official Ubuntu binaries, not mocked service commands.`,"",
    "The fixture project/agents were inserted by the scoped test helper using the production script generator. This tests the monitoring pipeline, not the browser registration form. The run uses the existing local XAMPP runtime in the separate project explicitly requested by the user; it is not the dedicated MySQL 8 integration suite.","",
    "## Cases","","| Agent | Final Recorded Result | Detail |","|---|---|---|"];
  for(const item of manifest.cases) {
    const record=records.filter(r=>r.case===item.name).at(-1);
    lines.push(`| [${item.name}](http://localhost:5173/projects/${manifest.project_id}/agents/${item.agent_id}) | ${record.status} | ${record.probable_cause??"Checks passed"} |`);
  }
  lines.push("","## Acceptance Assertions","","| Assertion | Result |","|---|---|");
  for(const [title,pass] of assertions) lines.push(`| ${title} | ${pass?"PASS":"FAIL"} |`);
  lines.push("","## Retained Initial Failures","",
    "Two initial attempts expected Healthy but correctly recorded Critical because of test-environment problems. Both failed observations remain in the JSON files and incident history:","",
    "- Middleware: WSL idle shutdown stopped the temporary services between commands. A host WSL keep-alive process was added, services were restored, and the same agent then reported Healthy, resolving the incident.",
    "- Apache: the WSL restart left a stale test PID file whose PID was reused by Nginx. Apache refused startup. The stale file was retained as apache.pid.before-wsl-restart, then Apache was restarted, served real HTTP 200, and its agent reported Healthy. No monitoring application code fix was required.","",
    "The 60-second heartbeat test also recorded a setup-time missed first heartbeat before its baseline report. That incident resolved on the baseline; a later deliberate missed heartbeat independently opened another incident through the real five-second backend worker.","",
    "## Review Notes","",
    "- Most agents use a one-hour heartbeat interval to keep the captured states reviewable. The deliberate heartbeat-expiry case uses 60 seconds. No agent cron schedule was installed: these are retained one-shot scenario snapshots and will become overdue if no new report is sent after their intervals.",
    "- Test-only API timeouts were accelerated to one second; the middleware /slow route waits three seconds. Production generation still defaults to 30 seconds.",
    "- Telegram was unconfigured throughout the run. Alert/recovery outbox records were retained, but no external Telegram messages were sent. Sending/retry/cooldown timing is not claimed as tested by this run.",
    "- Normal platform seven-day raw-history retention still applies. retained-data.json preserves the scoped samples/incidents/outbox and observations independently. No test project, agent, report, or test fixture was deleted.","",
    "## Test Infrastructure","",
    "- Ubuntu WSL; real Apache 2.4.58 and Nginx 1.24.0 packages extracted locally (no global web-server package installation).",
    "- Apache: http://127.0.0.1:18080/index.html inside WSL; Nginx: http://127.0.0.1:18081/; middleware: http://127.0.0.1:18082/health, /error, /slow.",
    `- WSL files and logs: ${manifest.wsl_directory}`,
    `- Private generated scripts: ${manifest.wsl_directory}/agents (root-only). Windows source scripts: ${manifest.private_directory}. Credentials are not included in this report or retained-data.json.`,
    "- Runtime units: apache2.service, nginx.service, server-check-wsl-middleware.service. All were absent before this test and are left running on isolated loopback ports. They are not enabled at boot; /run service definitions disappear when WSL stops.",
    "- Windows WSL keep-alive PID: 27984 (sleep infinity). Left running for inspection. No pre-existing services were stopped.","",
    "## Recorded Counts","",`- Observations: ${records.length}`,`- Metric samples: ${(data.metric_samples as unknown[]).length}`,
    `- Service samples: ${(data.service_check_samples as unknown[]).length}`,`- Incidents: ${(data.incidents as unknown[]).length}`,
    `- Notification records: ${outbox.length}; sent: ${sent}`,"",
    "The case JSON files contain expected/actual values, precise UTC timestamps, health diagnostics, sample counts, and incident lifecycle state. The platform displays local date/time. All retained records are scoped to this test project.","");
  await writeFile(path.join(manifest.report_directory,"REPORT.md"),lines.join("\n"),{flag:"wx"});
  console.log(JSON.stringify({project:manifest.project_id,assertions:assertions.length,passed:assertions.filter(([,pass])=>pass).length,
    observations:records.length,samples:(data.metric_samples as unknown[]).length,incidents:(data.incidents as unknown[]).length,outbox:outbox.length,sent,
    report:path.join(manifest.report_directory,"REPORT.md")},null,2));
  if(assertions.some(([,pass])=>!pass)) process.exitCode=1;
} finally { await closePool(); }
