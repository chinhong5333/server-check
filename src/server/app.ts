import { existsSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { AppConfig } from "./config.js";
import { verifyDatabaseConnection } from "./db.js";
import { AppError, asyncHandler, errorHandler } from "./errors.js";
import { createLogger } from "./logger.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createAuthRouter } from "./routes/auth.js";
import { createHeartbeatRouter } from "./routes/heartbeat.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createSettingsRouter } from "./routes/settings.js";
import { createAdminsRouter } from "./routes/admins.js";

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
