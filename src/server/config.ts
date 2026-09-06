import { loadEnvFile } from "node:process";
import { z } from "zod";

try {
  loadEnvFile();
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code !== "ENOENT") throw error;
}

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    PUBLIC_BASE_URL: z.string().url(),
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().min(1).max(65_535).default(3306),
    DB_NAME: z.string().regex(/^[a-zA-Z0-9_]+$/),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string(),
    DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),
    JWT_SECRET: z.string().min(32),
    JWT_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(900),
    SESSION_IDLE_TIMEOUT_SECONDS: z.coerce
      .number()
      .int()
      .min(900)
      .max(604_800)
      .default(28_800)
  });

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid application configuration: ${details}`);
  }

  const publicBaseUrl = new URL(parsed.data.PUBLIC_BASE_URL);
  return {
    nodeEnv: parsed.data.NODE_ENV,
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    publicBaseUrl,
    database: {
      host: parsed.data.DB_HOST,
      port: parsed.data.DB_PORT,
      name: parsed.data.DB_NAME,
      user: parsed.data.DB_USER,
      password: parsed.data.DB_PASSWORD,
      connectionLimit: parsed.data.DB_CONNECTION_LIMIT
    },
    jwt: {
      issuer: parsed.data.JWT_ISSUER,
      audience: parsed.data.JWT_AUDIENCE,
      secret: parsed.data.JWT_SECRET,
      ttlSeconds: parsed.data.JWT_TTL_SECONDS
    },
    sessionIdleTimeoutSeconds: parsed.data.SESSION_IDLE_TIMEOUT_SECONDS
  };
}

export function assertSafeTestDatabase(config: AppConfig): void {
  if (config.nodeEnv !== "test") {
    throw new Error("Database test guard refused: NODE_ENV must be test.");
  }

  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!localHosts.has(config.database.host)) {
    throw new Error("Database test guard refused: DB_HOST must be local.");
  }

  if (!config.database.name.endsWith("_test")) {
    throw new Error("Database test guard refused: DB_NAME must end with _test.");
  }
}
