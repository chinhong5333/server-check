import pino from "pino";
import type { AppConfig } from "./config.js";

export function createLogger(config: AppConfig) {
  return pino({
    level: config.nodeEnv === "test" ? "silent" : config.nodeEnv === "production" ? "info" : "debug",
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-csrf-token",
        "password",
        "current_password",
        "new_password",
        "req.body.password",
        "req.body.current_password",
        "req.body.new_password",
        "credential",
        "script",
        "config.database.password",
        "config.jwt.secret"
      ],
      censor: "[redacted]"
    }
  });
}
