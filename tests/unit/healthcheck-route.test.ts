import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../../src/server/app";
import type { AppConfig } from "../../src/server/config";

const { probe } = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("../../src/server/services/database-health.js", () => ({ createDatabaseHealthProbe: () => probe }));
const config = {
  nodeEnv: "test", host: "127.0.0.1", port: 3100,
  publicBaseUrl: new URL("http://127.0.0.1:3100"),
  database: { host: "127.0.0.1", port: 3306, name: "server_check_test", user: "synthetic", password: "unused", connectionLimit: 1 },
  jwt: { issuer: "test", audience: "test", secret: "a".repeat(48), ttlSeconds: 300 },
  sessionIdleTimeoutSeconds: 1800
} as AppConfig;
beforeEach(() => probe.mockReset());

it("serves the public /healthcheck response with the referenced format", async () => {
  probe.mockResolvedValue({ status: "alive", message: "", connection_count: 58, connection_max: 150,
    threads_running: 1, peak_connections: 67, long_queries: 0, db_size_mb: "8329.7", fragmented_mb: "46.0" });
  const response = await request(createApp(config).app).get("/healthcheck");
  expect(response.status).toBe(200);
  expect(Object.keys(response.body)).toEqual(["uptime", "message", "timestamp", "db"]);
  expect(response.body).toEqual({ uptime: expect.any(Number), message: "OK", timestamp: expect.any(Number),
    db: { status: "alive", message: "", connection_count: 58, connection_max: 150, threads_running: 1,
      peak_connections: 67, long_queries: 0, db_size_mb: "8329.7", fragmented_mb: "46.0" } });
  expect(response.headers["cache-control"]).toBe("no-store");
});

it("still returns HTTP 200 when DB status is fail", async () => {
  probe.mockResolvedValue({ status: "fail", message: "db probe unavailable", connection_count: null,
    connection_max: null, threads_running: null, peak_connections: null, long_queries: null,
    db_size_mb: null, fragmented_mb: null });
  const response = await request(createApp(config).app).get("/healthcheck");
  expect(response.status).toBe(200);
  expect(response.body.message).toBe("OK");
  expect(response.body.db.status).toBe("fail");
  expect(Object.values(response.body.db).slice(2)).toEqual(Array(7).fill(null));
});
