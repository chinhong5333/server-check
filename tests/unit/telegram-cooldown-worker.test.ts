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
    fetchMock.mockResolvedValue({ ok: true });
    let lastSentAt: number | null = null;
    executeMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM agents") && sql.includes("FOR UPDATE")) return [[{ id: "31", telegram_alert_cooldown_seconds: 900 }]];
      if (sql.includes("MAX(o.sent_at)")) return [[{ last_sent_at: lastSentAt }]];
      if (sql.includes("FOR UPDATE")) return [[{ attempt_count: 0, payload_json: payload, event_type: "opened", incident_status: "open" }]];
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
    expect(sentUpdate?.[1]?.[2]).toBe("1");

    const delayedUpdate = executeMock.mock.calls.find(([sql]) =>
      String(sql).includes("SET next_attempt_at = ?")
    );
    expect(delayedUpdate?.[1]).toEqual([now + 900_000, now, "2"]);
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
    executeMock.mockImplementation(async(sql:string)=>sql.includes("SELECT o.attempt_count")?[[{attempt_count:0,payload_json:payload,event_type:"opened",incident_status:"resolved"}]]:original(sql));
    await deliverTelegram(config);expect(fetchMock).not.toHaveBeenCalled();
    expect(executeMock.mock.calls.some(([sql])=>String(sql).includes("SET status = 'cancelled'"))).toBe(true);
  });
});
