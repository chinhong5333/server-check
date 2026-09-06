import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { telemetryPayloadSchema } from "../../src/shared/contracts.js";
import { generateAgentScript } from "../../src/server/services/agent-script.js";

const shell = existsSync("/bin/sh")
  ? "/bin/sh"
  : existsSync("C:\\Program Files\\Git\\bin\\sh.exe")
    ? "C:\\Program Files\\Git\\bin\\sh.exe"
    : null;

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");
  return address.port;
}

async function runScript(
  script: string,
  args: string[] = []
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(shell!, ["-s", "--", ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(script);
  });
}

describe.runIf(shell)("generated agent execution", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) => new Promise<void>((resolve) => server.close(() => resolve()))
      )
    );
  });

  it("probes a synthetic health API and reports one valid payload", async () => {
    const healthServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok"}');
    });
    servers.push(healthServer);
    const healthPort = await listen(healthServer);

    let receivedAuthorization = "";
    let receivedBody = "";
    const centralServer = createServer((request, response) => {
      receivedAuthorization = request.headers.authorization ?? "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        receivedBody += chunk;
      });
      request.on("end", () => {
        response.writeHead(202, { "content-type": "application/json" });
        response.end('{"heartbeat_accepted":true,"telemetry_accepted":true}');
      });
    });
    servers.push(centralServer);
    const centralPort = await listen(centralServer);

    const credential = "ag_2eaac131-76e2-4d36-b1f4-54ddf5a17a6f.synthetic-secret";
    const script = generateAgentScript({
      agentId: "2eaac131-76e2-4d36-b1f4-54ddf5a17a6f",
      projectName: "Synthetic project",
      agentName: "synthetic-agent-01",
      credential,
      centralApiUrl: `http://127.0.0.1:${centralPort}/api/v1/agent/heartbeats`,
      healthApiUrl: `http://127.0.0.1:${healthPort}/health`,
      healthRequestTimeoutSeconds: 5
    });

    const result = await runScript(script);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).not.toContain("regexp escape sequence");
    expect(result.stdout).toContain("heartbeat delivered");
    expect(receivedAuthorization).toBe(`Bearer ${credential}`);
    const payload = JSON.parse(receivedBody) as unknown;
    const parsed = telemetryPayloadSchema.safeParse(payload);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.flatten())).toBe(true);
    if (parsed.success) expect(parsed.data.health_probe.outcome).toBe("healthy");
  }, 20_000);

  it("prints collected statistics without calling the central API in dry-run mode", async () => {
    const healthServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok"}');
    });
    servers.push(healthServer);
    const healthPort = await listen(healthServer);

    let centralRequestCount = 0;
    const centralServer = createServer((_request, response) => {
      centralRequestCount += 1;
      response.writeHead(500, { "content-type": "application/json" });
      response.end('{"error":"dry_run_must_not_report"}');
    });
    servers.push(centralServer);
    const centralPort = await listen(centralServer);

    const script = generateAgentScript({
      agentId: "2eaac131-76e2-4d36-b1f4-54ddf5a17a6f",
      projectName: "Synthetic project",
      agentName: "synthetic-agent-01",
      credential: "ag_synthetic.secret",
      centralApiUrl:
        "http://127.0.0.1:" + centralPort + "/api/v1/agent/heartbeats",
      healthApiUrl: "http://127.0.0.1:" + healthPort + "/health",
      healthRequestTimeoutSeconds: 5
    });

    const result = await runScript(script, ["--dry-run"]);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).not.toContain("regexp escape sequence");
    expect(centralRequestCount).toBe(0);
    const payload = JSON.parse(result.stdout.trim()) as unknown;
    const parsed = telemetryPayloadSchema.safeParse(payload);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.flatten())).toBe(true);
    if (parsed.success) {
      expect(parsed.data.health_probe.outcome).toBe("healthy");
      expect(parsed.data.metrics?.cpu_count).toBeTypeOf("number");
      expect(Array.isArray(parsed.data.filesystems)).toBe(true);
    }
  }, 20_000);

  it("skips all disabled probes while still collecting telemetry", async () => {
    let requests = 0;
    const healthServer = createServer((_request, response) => { requests++; response.end("ok"); });
    servers.push(healthServer);
    const port = await listen(healthServer);
    const script = generateAgentScript({ agentId: "disabled-test", projectName: "Synthetic", agentName: "Disabled",
      credential: "synthetic", centralApiUrl: `http://127.0.0.1:${port}/central`, healthApiUrl: `http://127.0.0.1:${port}/health`,
      healthRequestTimeoutSeconds: 1, checks: { apache: false, nginx: false, middleware_api: false } });
    const result = await runScript("systemctl() { echo unexpected-service-check >&2; return 1; }\n" + script, ["--dry-run"]);
    expect(result.code, result.stderr).toBe(0);
    expect(requests).toBe(0);
    expect(result.stderr).not.toContain("unexpected-service-check");
    const payload = telemetryPayloadSchema.parse(JSON.parse(result.stdout));
    expect(payload.health_probe.outcome).toBe("disabled");
    expect(payload.health_probe.latency_ms).toBeNull();
    expect(payload.service_checks.apache.status).toBe("disabled");
    expect(payload.service_checks.nginx?.status).toBe("disabled");
  }, 20_000);

  it.each(["active", "inactive", "unknown"] as const)("reports Nginx %s from a synthetic service manager", async (state) => {
    const script = generateAgentScript({ agentId: `nginx-${state}-test`, projectName: "Synthetic", agentName: "Nginx",
      credential: "synthetic", centralApiUrl: "http://127.0.0.1:1/unused", healthApiUrl: null,
      healthRequestTimeoutSeconds: 1, checks: { apache: false, nginx: true, middleware_api: false } });
    const fakeManager = `systemctl() { case "$*" in *LoadState*) printf loaded ;; *) printf '${state}' ;; esac; }\npgrep() { return 1; }\n`;
    const result = await runScript(fakeManager + script, ["--dry-run"]);
    expect(result.code, result.stderr).toBe(0);
    expect(telemetryPayloadSchema.parse(JSON.parse(result.stdout)).service_checks.nginx?.status).toBe(state);
  }, 20_000);
});
