import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import type { AppConfig } from "../../src/server/config.js";

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

describe("central API shell", () => {
  const { app } = createApp(config);

  it("serves process liveness without a database mutation", async () => {
    const response = await request(app).get("/api/v1/health/live");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
  });

  it("returns a structured API 404", async () => {
    const response = await request(app).get("/api/v1/not-a-route");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("route_not_found");
  });

  it("protects platform Telegram settings behind internal authentication", async () => {
    const response = await request(app).get("/api/v1/settings/telegram");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("authentication_required");
  });

  it("protects agent incident history behind internal authentication", async () => {
    const response = await request(app).get("/api/v1/agents/agent-1/incidents");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("authentication_required");
  });

  it("protects project deletion behind internal authentication", async () => {
    const response = await request(app)
      .delete("/api/v1/projects/project-1")
      .send({ confirmation_name: "Project Atlas" });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("authentication_required");
  });
});
