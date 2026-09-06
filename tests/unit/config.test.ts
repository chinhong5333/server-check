import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config.js";

const requiredEnvironment = {
  NODE_ENV: "development",
  HOST: "127.0.0.1",
  PORT: "3000",
  PUBLIC_BASE_URL: "http://127.0.0.1:3000",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "server_check",
  DB_USER: "server_check_app",
  DB_PASSWORD: "database-password",
  DB_CONNECTION_LIMIT: "10",
  JWT_ISSUER: "server-check",
  JWT_AUDIENCE: "server-check-backoffice",
  JWT_SECRET: "a".repeat(48),
  JWT_TTL_SECONDS: "900",
  SESSION_IDLE_TIMEOUT_SECONDS: "28800"
};

describe("application configuration", () => {
  it("does not read legacy initial-administrator environment fields", () => {
    const config = loadConfig({
      ...requiredEnvironment,
      INITIAL_ADMIN_EMAIL: "legacy@example.com",
      INITIAL_ADMIN_PASSWORD: "short"
    });
    expect(config).not.toHaveProperty("initialAdmin");
  });
});
