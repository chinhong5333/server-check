import { describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import { DEFAULT_AGENT_CHECKS, generateAgentScriptBodySchema, healthProbeSchema, type TelemetryPayload } from "../../src/shared/contracts";
import { matchesConfiguredChecks, readAgentChecks } from "../../src/server/services/check-configuration";
import { evaluateTelemetryIncidents } from "../../src/server/services/incidents";

const payload: TelemetryPayload = {
  sequence_id: 1, observed_at: 1, agent_version: "1.3.0",
  health_probe: { checked_at: 1, outcome: "disabled", http_status_code: null, latency_ms: null, error_code: null, error_message: null },
  metrics: { cpu_count: 1, load_1: 0, load_5: 0, load_15: 0, memory_total_bytes: 100,
    memory_available_bytes: 80, swap_total_bytes: 0, swap_free_bytes: 0, uptime_seconds: 100 },
  filesystems: [], top_processes: [],
  service_checks: { apache: { service_name: "apache2", status: "disabled" }, nginx: { service_name: "nginx", status: "disabled" } }
};
const policy = { agentInternalId: "1", agentPublicId: "agent-test", serverName: "test-agent", projectInternalId: "2",
  projectName: "Test", ramThreshold: 15, diskThreshold: 10, loadThreshold: 1 };

describe("Optional monitoring contract", () => {
  it("preserves legacy configuration and requires an explicit null URL when disabled", () => {
    expect(readAgentChecks(null)).toEqual(DEFAULT_AGENT_CHECKS);
    expect(generateAgentScriptBodySchema.parse({ health_api_url: "https://example.test/health" }).checks).toEqual(DEFAULT_AGENT_CHECKS);
    expect(generateAgentScriptBodySchema.safeParse({ health_api_url: null, checks: { apache: false, nginx: true, middleware_api: false } }).success).toBe(true);
    expect(generateAgentScriptBodySchema.safeParse({ health_api_url: null, checks: DEFAULT_AGENT_CHECKS }).success).toBe(false);
    expect(generateAgentScriptBodySchema.safeParse({ health_api_url: "https://example.test/", checks: { ...DEFAULT_AGENT_CHECKS, middleware_api: false } }).success).toBe(false);
    expect(generateAgentScriptBodySchema.safeParse({ health_api_url: null, checks: { apache: false, nginx: true, middlewareApi: false } }).success).toBe(false);
  });
  it("rejects forged HTTP results for disabled checks", () => {
    expect(healthProbeSchema.safeParse({ ...payload.health_probe, http_status_code: 200 }).success).toBe(false);
  });
  it("rejects payloads that silently disable a configured service", () => {
    expect(matchesConfiguredChecks({ apache: false, nginx: false, middleware_api: false }, payload)).toBe(true);
    expect(matchesConfiguredChecks({ apache: false, nginx: true, middleware_api: false }, payload)).toBe(false);
    expect(matchesConfiguredChecks(DEFAULT_AGENT_CHECKS, payload)).toBe(false);
  });
});

describe("Service incident evaluation", () => {
  it.each([ ["active", "healthy"], ["inactive", "critical"], ["unknown", "warning"], ["disabled", "healthy"] ] as const)(
    "maps Nginx %s to %s without inventing health for unknown results", async (status, expected) => {
      const execute = vi.fn(async (sql: string) => sql.trim().startsWith("SELECT") ? [[]] : [{ insertId: 9 }]);
      const result = await evaluateTelemetryIncidents({ execute } as unknown as PoolConnection, policy,
        { ...payload, service_checks: { ...payload.service_checks, nginx: { service_name: "nginx", status } } }, 1000);
      expect(result.status).toBe(expected);
      const inserts = execute.mock.calls.filter(([sql]) => sql.includes("INSERT INTO incidents"));
      expect(inserts).toHaveLength(expected === "healthy" ? 0 : 1);
    }
  );
  it("makes an unhealthy middleware API critical independently of Apache", async () => {
    const execute = vi.fn(async (sql: string) => sql.trim().startsWith("SELECT") ? [[]] : [{ insertId: 9 }]);
    const result = await evaluateTelemetryIncidents({ execute } as unknown as PoolConnection, policy,
      { ...payload, health_probe: { ...payload.health_probe, outcome: "unhealthy", http_status_code: 503, error_code: "http_status_error" } }, 1000);
    expect(result.status).toBe("critical");
    expect(result.probableCause).toContain("middleware API");
  });

  it("does not announce recovery when an inactive service becomes unknown", async () => {
    const execute = vi.fn(async (sql: string) => sql.trim().startsWith("SELECT")
      ? [[{ id: "3", public_id: "incident-test", incident_type: "nginx_inactive" }]] : [{ insertId: 9 }]);
    const result = await evaluateTelemetryIncidents({ execute } as unknown as PoolConnection, policy,
      { ...payload, service_checks: { ...payload.service_checks, nginx: { service_name: "nginx", status: "unknown" } } }, 1000);
    expect(result.status).toBe("critical");
    expect(execute.mock.calls.some(([sql]) => sql.includes("SET status = 'resolved'"))).toBe(false);
  });
});
