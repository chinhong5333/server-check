import { existsSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { AppConfig } from "./config.js";
import { getPool, verifyDatabaseConnection, type RowDataPacket } from "./db.js";
import { AppError, asyncHandler, errorHandler } from "./errors.js";
import { createLogger } from "./logger.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createAuthRouter } from "./routes/auth.js";
import { createHeartbeatRouter } from "./routes/heartbeat.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createSettingsRouter } from "./routes/settings.js";
import { createAdminsRouter } from "./routes/admins.js";
import { createDatabaseHealthProbe, type DatabaseHealth } from "./services/database-health.js";

export function createApp(config: AppConfig) {
  const app = express();
  const logger = createLogger(config);
  if (config.nodeEnv === "production") app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          fontSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(pinoHttp({
    logger,
    // Keep failed-server-request diagnostics without logging every dashboard poll or heartbeat.
    customLogLevel: (_request, response, error) => error || response.statusCode >= 500 ? "error" : "silent"
  }));
  app.use(cookieParser());

  const checkDatabaseHealth = createDatabaseHealthProbe(async (sql) => {
    const [rows] = await getPool(config).query<RowDataPacket[]>({ sql, timeout: 2000 });
    return rows;
  }, (message) => logger.warn({ message }, "Health check DB probe failed"));

  /**
   * GET /healthcheck
   * Reports process liveness and the configured MySQL database state without requiring authentication.
   * @param {import("express").Request<{}, {}, Record<string, never>, Record<string, never>>} request No path, query, or body fields are used.
   * @param {import("express").Response<{uptime: number, message: "OK", timestamp: number, db: DatabaseHealth}>} response HTTP 200 with the stable health payload, including db.status when MySQL fails.
   * @returns {Promise<void>} Resolves after a read-only database probe and best-effort metrics lookup.
   */
  app.get("/healthcheck", asyncHandler(async (_request, response) => {
    const db: DatabaseHealth = await checkDatabaseHealth();
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ uptime: process.uptime(), message: "OK", timestamp: Date.now(), db });
  }));

  /**
   * GET /api/v1/health/live
   * Confirms that the central Node.js process is running.
   * @param {import("express").Request} request Request body and query must be empty.
   * @param {import("express").Response<{status: "ok"}>} response Liveness response.
   * @returns {void} Sends the process status immediately.
   */
  app.get("/api/v1/health/live", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  /**
   * GET /api/v1/health/ready
   * Confirms that the central process can reach its configured database.
   * @param {import("express").Request} request Request body and query must be empty.
   * @param {import("express").Response<{status: "ready"}>} response Readiness response.
   * @returns {Promise<void>} Resolves after a read-only database probe.
   */
  app.get(
    "/api/v1/health/ready",
    asyncHandler(async (_request, response) => {
      await verifyDatabaseConnection(config);
      response.status(200).json({ status: "ready" });
    })
  );

  app.use("/api/v1/agent/heartbeats", createHeartbeatRouter(config));
  app.use(express.json({ limit: "256kb", strict: true }));
  app.use("/api/v1/auth", createAuthRouter(config));
  app.use("/api/v1/projects", createProjectsRouter(config));
  app.use("/api/v1/agents", createAgentsRouter(config));
  app.use("/api/v1/settings", createSettingsRouter(config));
  app.use("/api/v1/admins", createAdminsRouter(config));

  app.use("/api", (_request, _response, next) => {
    next(new AppError(404, "route_not_found", "The requested API route does not exist."));
  });

  const clientDirectory = path.resolve(process.cwd(), "dist/client");
  if (existsSync(clientDirectory)) {
    app.use(express.static(clientDirectory, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_request, response) => {
      response.sendFile(path.join(clientDirectory, "index.html"));
    });
  }

  app.use(errorHandler);
  return { app, logger };
}
