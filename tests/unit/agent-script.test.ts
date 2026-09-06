import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  cronForInterval,
  generateAgentScript,
  normalizeHealthApiUrl,
  shellCommentValue,
  shellSingleQuote
} from "../../src/server/services/agent-script.js";

describe("agent script generator", () => {
  const localShell = existsSync("C:\\Program Files\\Git\\bin\\sh.exe")
    ? "C:\\Program Files\\Git\\bin\\sh.exe"
    : null;

  it("generates one self-contained script with the required workflow", () => {
    const script = generateAgentScript({
      agentId: "2eaac131-76e2-4d36-b1f4-54ddf5a17a6f",
      projectName: "Project Atlas",
      agentName: "atlas-web-01",
      credential: "ag_2eaac131-76e2-4d36-b1f4-54ddf5a17a6f.secret",
      centralApiUrl: "https://monitor.example.com/api/v1/agent/heartbeats",
      healthApiUrl: "http://127.0.0.1:3000/health",
      healthRequestTimeoutSeconds: 30
    });

    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain("# Project: Project Atlas");
    expect(script).toContain("# Agent: atlas-web-01");
    expect(script).toContain("HEALTH_API_URL='http://127.0.0.1:3000/health'");
    expect(script).toContain("HEALTH_TIMEOUT='30'");
    expect(script).toContain("CENTRAL_API_URL='https://monitor.example.com/api/v1/agent/heartbeats'");
    expect(script).toContain("/proc/meminfo");
    expect(script).toContain("/proc/loadavg");
    expect(script).toContain("df -PkP -x tmpfs -x devtmpfs");
    expect(script).toContain("/opt/lampp/lampp status");
    expect(script).toContain("for APACHE_CANDIDATE in apache2 httpd");
    expect(script).toContain("--property=ActiveState --value");
    expect(script.indexOf("/opt/lampp/lampp status")).toBeLessThan(
      script.indexOf('APACHE_STATUS="$(systemd_state "$APACHE_CANDIDATE")"')
    );
    expect(script).not.toContain("APACHE_SERVICE_NAME='apache2'");
    expect(script).toContain("Authorization: Bearer $AGENT_CREDENTIAL");
    expect(script).toContain("mkdir \"$LOCK_DIR\"");
    expect(script).not.toMatch(/\beval\b/);
  });

  it("shell-quotes configuration without allowing command structure changes", () => {
    expect(shellSingleQuote("https://host.test/a'b")).toBe(
      `'https://host.test/a'\"'\"'b'`
    );
  });

  it("flattens control characters before recording names in shell comments", () => {
    expect(shellCommentValue("Project\nAtlas\r\nProduction")).toBe("Project Atlas Production");
  });

  it("accepts only HTTP(S) health URLs without embedded credentials", () => {
    expect(normalizeHealthApiUrl("http://127.0.0.1:3000/health#fragment")).toBe(
      "http://127.0.0.1:3000/health"
    );
    expect(() => normalizeHealthApiUrl("file:///etc/passwd")).toThrow(/http or https/);
    expect(() => normalizeHealthApiUrl("https://user:secret@example.com/health")).toThrow(
      /embedded credentials/
    );
  });

  it("generates only supported cron intervals", () => {
    expect(cronForInterval(60, "/opt/server check/agent.sh")).toBe(
      `*/1 * * * * /bin/sh '/opt/server check/agent.sh'`
    );
    expect(cronForInterval(3600, "/opt/agent.sh")).toBe("0 * * * * /bin/sh '/opt/agent.sh'");
    expect(() => cronForInterval(420, "/opt/agent.sh")).toThrow(/Supported cron intervals/);
  });

  it.runIf(localShell)("passes a real POSIX shell syntax check", () => {
    const script = generateAgentScript({
      agentId: "2eaac131-76e2-4d36-b1f4-54ddf5a17a6f",
      projectName: "Project Atlas",
      agentName: "atlas-web-01",
      credential: "ag_2eaac131-76e2-4d36-b1f4-54ddf5a17a6f.secret",
      centralApiUrl: "https://monitor.example.com/api/v1/agent/heartbeats",
      healthApiUrl: "http://127.0.0.1:3000/health",
      healthRequestTimeoutSeconds: 30
    });
    const result = spawnSync(localShell!, ["-n"], { input: script, encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
