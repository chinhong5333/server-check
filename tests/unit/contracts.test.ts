import { describe, expect, it } from "vitest";
import {
  createAgentInstallationBodySchema,
  DEFAULT_AGENT_CHECKS,
  createProjectBodySchema,
  loginBodySchema,
  telemetryPayloadSchema,
  updateAgentBodySchema,
  updatePlatformTelegramBodySchema
} from "../../src/shared/contracts.js";

describe("login contract", () => {
  it("uses one optional canonical remember-session flag", () => {
    expect(loginBodySchema.parse({ email: "admin@example.com", password: "secret" }).remember_session).toBe(false);
    expect(loginBodySchema.parse({ email: "admin@example.com", password: "secret", remember_session: true }).remember_session).toBe(true);
    expect(loginBodySchema.safeParse({ email: "admin@example.com", password: "secret", rememberSession: true }).success).toBe(false);
  });
});

const validPayload = {
  sequence_id: 1_788_252_764_000,
  observed_at: 1_788_252_764_000,
  agent_version: "1.0.0",
  health_probe: {
    checked_at: 1_788_252_764_000,
    outcome: "unhealthy",
    http_status_code: 503,
    latency_ms: 120,
    error_code: "http_status_error",
    error_message: null
  },
  metrics: {
    cpu_count: 4,
    load_1: 1.2,
    load_5: 1.1,
    load_15: 0.9,
    memory_total_bytes: 8_589_934_592,
    memory_available_bytes: 2_147_483_648,
    swap_total_bytes: 2_147_483_648,
    swap_free_bytes: 1_073_741_824,
    uptime_seconds: 1000
  },
  filesystems: [
    {
      filesystem: "/dev/sda1",
      mount_point: "/",
      total_bytes: 100_000,
      available_bytes: 10_000,
      inode_used_percent: 30
    }
  ],
  top_processes: [{ command: "node", cpu_percent: 12.5, memory_percent: 4.2 }],
  service_checks: { apache: { service_name: "apache2", status: "active" } }
};

describe("telemetry contract", () => {
  it("treats an unhealthy application result as valid telemetry", () => {
    expect(telemetryPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects guessed aliases and unknown fields", () => {
    const result = telemetryPayloadSchema.safeParse({
      ...validPayload,
      observedAt: validPayload.observed_at
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-canonical health error codes", () => {
    const result = telemetryPayloadSchema.safeParse({
      ...validPayload,
      health_probe: { ...validPayload.health_probe, error_code: "ECONNREFUSED" }
    });
    expect(result.success).toBe(false);
  });
});

describe("project contract", () => {
  const project = { name: "Test" };

  it("accepts a name-only project", () => {
    expect(createProjectBodySchema.safeParse(project).success).toBe(true);
  });

  it("rejects project-level monitoring policy fields", () => {
    expect(
      createProjectBodySchema.safeParse({ ...project, heartbeat_interval_seconds: 120 }).success
    ).toBe(false);
  });
});

describe("agent installation contract", () => {
  const installation = {
    server_name: "test-agent-01",
    health_api_url: "https://example.com/api/health-check",
    ram_available_threshold_percent: 15,
    disk_available_threshold_percent: 10,
    load_5_per_core_threshold: 1.5,
    heartbeat_interval_seconds: 120,
    telegram_alert_cooldown_seconds: 900
  };

  it("accepts only the operator-editable agent fields", () => {
    const result = createAgentInstallationBodySchema.safeParse(installation);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ ...installation, checks: DEFAULT_AGENT_CHECKS });
    }
    expect(
      createAgentInstallationBodySchema.safeParse({
        ...installation,
        health_request_timeout_seconds: 15
      }).success
    ).toBe(false);
  });

  it("uses the same strict editable fields for agent updates", () => {
    const { health_api_url, ...editable } = installation;
    expect(updateAgentBodySchema.safeParse(editable).success).toBe(true);
    expect(updateAgentBodySchema.safeParse(installation).success).toBe(false);
    expect(
      updateAgentBodySchema.safeParse({ ...installation, credential: "caller-controlled" }).success
    ).toBe(false);
    expect(
      updateAgentBodySchema.safeParse({ ...installation, health_request_timeout_seconds: 15 }).success
    ).toBe(false);
  });

  it("rejects the removed Apache service-name input", () => {
    expect(
      createAgentInstallationBodySchema.safeParse({
        ...installation,
        apache_service_name: "apache2"
      }).success
    ).toBe(false);
  });
});

describe("platform Telegram contract", () => {
  it("accepts platform bot credentials with a numeric chat ID or channel username", () => {
    expect(
      updatePlatformTelegramBodySchema.safeParse({
        telegram_bot_token: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcd",
        telegram_chat_id: "-1001234567890"
      }).success
    ).toBe(true);
    expect(
      updatePlatformTelegramBodySchema.safeParse({ telegram_chat_id: "@ops_alerts" }).success
    ).toBe(true);
    expect(updatePlatformTelegramBodySchema.safeParse({ telegram_chat_id: null }).success).toBe(true);
  });

  it("rejects malformed and non-canonical Telegram inputs", () => {
    expect(
      updatePlatformTelegramBodySchema.safeParse({ telegram_chat_id: "ops alerts" }).success
    ).toBe(false);
    expect(updatePlatformTelegramBodySchema.safeParse({ telegram_chat_id: "" }).success).toBe(false);
    expect(
      updatePlatformTelegramBodySchema.safeParse({
        telegram_bot_token: "not-a-telegram-token",
        telegram_chat_id: "@ops_alerts",
        chat_id: "@alias"
      }).success
    ).toBe(false);
  });
});
