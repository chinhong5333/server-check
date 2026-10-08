import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config.js";

const { executeMock, fetchMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  fetchMock: vi.fn()
}));

vi.mock("../../src/server/db.js", () => ({
  getPool: () => ({ execute: executeMock }),
  withTransaction: async (_config: unknown, operation: (connection: unknown) => Promise<unknown>) => operation({ execute: executeMock })
}));

vi.mock("../../src/server/security/telegram-secrets.js", () => ({
  decryptPlatformTelegramBotToken: () => "telegram-test-token"
}));

import { deliverTelegram } from "../../src/server/workers.js";
import { queueTelegramNotification } from "../../src/server/services/alert-queue.js";
import type { PoolConnection } from "mysql2/promise";

const config: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3100,
  publicBaseUrl: new URL("http://127.0.0.1:3100"),
  database: {
    host: "127.0.0.1",
    port: 3306,
    name: "server_check_test",
    user: "server_check_test",
    password: "not-used",
    connectionLimit: 1
  },
  jwt: {
    issuer: "server-check-test",
    audience: "server-check-backoffice-test",
    secret: "a".repeat(48),
    ttlSeconds: 300
  },
  sessionIdleTimeoutSeconds: 1800
};

const now = 1_788_253_200_000;
const payload = {
  project_name: "Project Atlas",
  server_name: "atlas-web-01",
  probable_cause: "Heartbeat overdue",
  severity: "critical"
};

describe("per-agent Telegram delivery cooldown", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.stubGlobal("fetch", fetchMock);
    executeMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    let lastSentAt: number | null = null;
    let transportDue = 0, blockedUntil = 0;
    executeMock.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM agents") && sql.includes("FOR UPDATE")) return [[{ id: "31", telegram_alert_cooldown_seconds: 900, telegram_recovery_cooldown_seconds: 30 }]];
      if (sql.includes("MAX(o.sent_at)")) return [[{ last_sent_at: lastSentAt }]];
      if (sql.includes("FROM telegram_delivery_state")) return [[{ next_delivery_at: transportDue, blocked_until: blockedUntil }]];
      if (sql.includes("UPDATE telegram_delivery_state")) { transportDue = Number(values[0]); if (sql.includes("blocked_until")) blockedUntil = Math.max(blockedUntil, Number(values[1])); }
      if (sql.includes("FOR UPDATE")) return [[{ incident_id: "incident-1", attempt_count: 0, payload_json: { ...payload }, event_type: "opened", incident_status: "open", next_attempt_at: now }]];
      if (sql.includes("SET status = 'sent'")) lastSentAt = now;
      if (sql.includes("FROM platform_telegram_settings")) {
        return [[{ telegram_bot_token_encrypted: "encrypted", telegram_chat_id: "-100123" }], []];
      }
      if (sql.includes("FROM notification_outbox outbox")) {
        return [[
          {
            id: "1",
            agent_id: "31",
            payload_json: payload,
            attempt_count: 0,
            telegram_alert_cooldown_seconds: 900,
            last_sent_at: null
          },
          {
            id: "2",
            agent_id: "31",
            payload_json: payload,
            attempt_count: 0,
            telegram_alert_cooldown_seconds: 900,
            last_sent_at: null
          }
        ], []];
      }
      return [{ affectedRows: 1 }];
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends one message and delays the next queued message for the same agent", async () => {
    await deliverTelegram(config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sentUpdate = executeMock.mock.calls.find(([sql]) =>
      String(sql).includes("SET status = 'sent'")
    );
    expect(sentUpdate?.[1]?.[3]).toBe("1");

    const delayedUpdate = executeMock.mock.calls.find(([sql]) =>
      String(sql).includes("SET next_attempt_at = ?")
    );
    expect(delayedUpdate?.[1]).toEqual([now + 900_000, now, "2"]);
  });
  it("rechecks maintenance after queue selection and suppresses delivery without retrying", async () => {
    const original = executeMock.getMockImplementation()!;
    executeMock.mockImplementation(async (sql: string) => sql.includes("FROM maintenance_windows") ? [[{ id: "maintenance" }]] : original(sql));
    await deliverTelegram(config);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(executeMock.mock.calls.some(([sql]) => String(sql).includes("Suppressed during maintenance"))).toBe(true);
    expect(executeMock.mock.calls.some(([sql]) => String(sql).includes("attempt_count = ?"))).toBe(false);
  });
  it("holds expired maintenance delivery until the resume transition is completed", async () => {
    const original = executeMock.getMockImplementation()!;
    executeMock.mockImplementation(async (sql: string) => sql.includes("FROM maintenance_windows")
      ? [sql.includes("completed_at IS NULL") ? [{ id: "expired" }] : []] : original(sql));
    await deliverTelegram(config);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(executeMock.mock.calls.some(([sql]) => String(sql).includes("SET status = 'sent'"))).toBe(false);
  });
  it("does not send a row cancelled after initial queue selection", async () => {
    const original = executeMock.getMockImplementation()!;
    executeMock.mockImplementation(async (sql: string) => sql.includes("FROM notification_outbox") && sql.includes("FOR UPDATE") ? [[], []] : original(sql));
    await deliverTelegram(config);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(executeMock.mock.calls.some(([sql]) => String(sql).includes("SET status = 'sent'"))).toBe(false);
  });
  it("rechecks the latest send interval after obtaining the agent lock",async()=>{
    const original=executeMock.getMockImplementation()!;
    executeMock.mockImplementation(async(sql:string)=>sql.includes("MAX(o.sent_at)")?[[{last_sent_at:now}]]:original(sql));
    await deliverTelegram(config);expect(fetchMock).not.toHaveBeenCalled();
    expect(executeMock.mock.calls.some(([sql])=>String(sql).includes("SET next_attempt_at = ?"))).toBe(true);
  });
  it("does not send a legacy pending error whose incident already recovered",async()=>{
    const original=executeMock.getMockImplementation()!;
    executeMock.mockImplementation(async(sql:string)=>sql.includes("SELECT o.incident_id")?[[{attempt_count:0,payload_json:payload,event_type:"opened",incident_status:"resolved"}]]:original(sql));
    await deliverTelegram(config);expect(fetchMock).not.toHaveBeenCalled();
    expect(executeMock.mock.calls.some(([sql])=>String(sql).includes("SET status = 'cancelled'"))).toBe(true);
  });
  it("sends a stable recovery on its own timer without moving the issue-alert deadline", async () => {
    const original = executeMock.getMockImplementation()!;
    executeMock.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT o.incident_id") && values[0] === "1") return [[{ incident_id: "incident-1", attempt_count: 0, payload_json: { ...payload, severity: undefined, incident_type: "health_api_unhealthy" }, event_type: "resolved", incident_type: "health_api_unhealthy", incident_status: "resolved", resolved_at: now - 30_000, next_attempt_at: now + 840_000 }]];
      if (sql.includes("AS issue_delivered")) return [[{ issue_delivered: 1, recovery_delivered: 0, condition_reopened: 0, remaining_open: 2 }]];
      if (sql.includes("MAX(o.sent_at)")) return [[{ last_sent_at: now - 60_000 }]];
      return original(sql, values);
    });
    await deliverTelegram(config);
    expect(fetchMock).toHaveBeenCalledOnce();
    const message = JSON.parse(fetchMock.mock.calls[0][1].body).text;
    expect(message).toContain("Recovered Check: Middleware API");
    expect(message).toContain("Other Open Issues: 2");
    expect(executeMock.mock.calls.some(([sql, values]) => String(sql).includes("MAX(o.sent_at)") && values[1] === "resolved")).toBe(true);
    expect(executeMock.mock.calls.some(([sql, values]) => String(sql).includes("SET next_attempt_at = ?") && values[0] === now + 840_000 && values[2] === "2")).toBe(true);
  });
  it("cancels recovery when its issue alert was never delivered", async () => {
    const original = executeMock.getMockImplementation()!;
    executeMock.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT o.incident_id")) return [[{ incident_id: "incident-1", event_type: "resolved", incident_type: "disk_low", incident_status: "resolved", resolved_at: now - 30_000, attempt_count: 0 }]];
      if (sql.includes("AS issue_delivered")) return [[{ issue_delivered: 0, recovery_delivered: 0, condition_reopened: 0, remaining_open: 0 }]];
      return original(sql, values);
    });
    await deliverTelegram(config);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(executeMock.mock.calls.some(([sql]) => String(sql).includes("Recovery is unnotified"))).toBe(true);
  });
  it("cancels a stale recovery when the same condition reopened", async () => {
    const original = executeMock.getMockImplementation()!;
    executeMock.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT o.incident_id")) return [[{ incident_id: "incident-1", event_type: "resolved", incident_type: "disk_low", incident_status: "resolved", resolved_at: now - 30_000, attempt_count: 0 }]];
      if (sql.includes("AS issue_delivered")) return [[{ issue_delivered: 1, recovery_delivered: 0, condition_reopened: 1, remaining_open: 1 }]];
      return original(sql, values);
    });
    await deliverTelegram(config);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(executeMock.mock.calls.some(([sql]) => String(sql).includes("SET status = 'cancelled'"))).toBe(true);
  });
  it("uses one shared Telegram transport limiter across different agents", async () => {
    const original = executeMock.getMockImplementation()!;
    executeMock.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM notification_outbox outbox")) return [[{ id: "1", agent_id: "31" }, { id: "2", agent_id: "42" }]];
      if (sql.includes("MAX(o.sent_at)") && values[0] === "42") return [[{ last_sent_at: null }]];
      return original(sql, values);
    });
    await deliverTelegram(config);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(executeMock.mock.calls.some(([sql, values]) => String(sql).includes("SET next_attempt_at = ?") && values[0] === now + 3100 && values[2] === "2")).toBe(true);
  });
  it("honors Telegram retry_after and blocks other messages until flood control expires", async () => {
    const original = executeMock.getMockImplementation()!;
    executeMock.mockImplementation(async (sql: string, values: unknown[] = []) => {
      const result = await original(sql, values);
      if (sql.includes("SELECT o.incident_id")) result[0][0].attempt_count = 12;
      return result;
    });
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ ok: false, error_code: 429, parameters: { retry_after: 45 } }) });
    await deliverTelegram(config);
    expect(fetchMock).toHaveBeenCalledOnce();
    const retry = executeMock.mock.calls.find(([sql]) => String(sql).includes("attempt_count = ?"));
    expect(retry?.[1]?.slice(0, 3)).toEqual(["pending", 13, now + 45_000]);
    expect(String(retry?.[1]?.[3])).not.toContain("telegram-test-token");
    expect(executeMock.mock.calls.some(([sql, values]) => String(sql).includes("SET next_attempt_at = ?") && values[0] === now + 45_000 && values[2] === "2")).toBe(true);
  });
  it("debounces and deduplicates recovery collection without restarting its stability delay", async () => {
    let pending = false;
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("FROM maintenance_windows")) return [[]];
      if (sql.includes("SELECT a.telegram_recovery_cooldown_seconds")) return [[{ telegram_recovery_cooldown_seconds: 30 }]];
      if (sql.includes("SELECT id FROM notification_outbox")) return [pending ? [{ id: "recovery-1" }] : []];
      if (sql.includes("INSERT INTO notification_outbox")) pending = true;
      return [{ affectedRows: 1 }];
    });
    const connection = { execute } as unknown as PoolConnection;
    await queueTelegramNotification(connection, "project", "incident", "resolved", { incident_type: "disk_low" }, now);
    await queueTelegramNotification(connection, "project", "incident", "resolved", { incident_type: "disk_low" }, now + 5_000);
    const inserts = execute.mock.calls.filter(([sql]) => sql.includes("INSERT INTO notification_outbox"));
    expect(inserts).toHaveLength(1);
    expect((execute as ReturnType<typeof vi.fn>).mock.calls.find(([sql]) => String(sql).includes("INSERT INTO notification_outbox"))?.[1]?.[5]).toBe(now + 30_000);
    expect(execute.mock.calls.some(([sql]) => sql.includes("UPDATE notification_outbox SET payload_json"))).toBe(true);
  });
  it("delivers a completed restart event once using the issue channel without a recovery message", async () => {
    const original = executeMock.getMockImplementation()!;
    let notified = false;
    executeMock.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT o.incident_id")) return [[{ incident_id: "restart-1", attempt_count: 0, next_attempt_at: now,
        payload_json: { ...payload, severity: "warning", incident_type: "server_restart", details: { previous_uptime_seconds: 100000, current_uptime_seconds: 30 } },
        event_type: "opened", incident_type: "server_restart", incident_status: "resolved" }]];
      if (sql.includes("SELECT id FROM notification_outbox") && sql.includes("status = 'sent'")) return [notified ? [{ id: "already-sent" }] : []];
      if (sql.includes("SET status = 'sent'")) notified = true;
      return original(sql, values);
    });
    await deliverTelegram(config);
    expect(fetchMock).toHaveBeenCalledOnce();
    const text = JSON.parse(fetchMock.mock.calls[0][1].body).text;
    expect(text).toContain("Possible Server Restart"); expect(text).toContain("Current Uptime: 30 Seconds"); expect(text).not.toContain("[RECOVERY]");
    expect(executeMock.mock.calls.some(([sql]) => String(sql).includes("Restart event was already notified"))).toBe(true);
  });
});
