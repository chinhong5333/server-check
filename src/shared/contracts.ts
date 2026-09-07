import { z } from "zod";

export const roleSchema = z.enum(["admin", "operator"]);
export type InternalRole = z.infer<typeof roleSchema>;

export const accountPasswordSchema = z.string().min(15).max(128);
export const changePasswordBodySchema = z.object({
  current_password: z.string().min(1).max(1024),
  new_password: accountPasswordSchema
}).strict().refine((value) => value.current_password !== value.new_password, {
  message: "Choose a different new password.", path: ["new_password"]
});

export const DEFAULT_HEALTH_REQUEST_TIMEOUT_SECONDS = 30;
export const REMEMBER_SESSION_SECONDS = 7 * 24 * 60 * 60;

export const loginBodySchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(1024),
    remember_session: z.boolean().default(false)
  })
  .strict();

const agentPolicyShape = {
  ram_available_threshold_percent: z.number().min(0.1).max(99.9),
  disk_available_threshold_percent: z.number().min(0.1).max(99.9),
  load_5_per_core_threshold: z.number().min(0.1).max(100),
  heartbeat_interval_seconds: z.number().int().min(60).max(3600)
};

/** @deprecated Project policy is no longer an active API; retained for the legacy page module. */
export const updateProjectPolicyBodySchema = z.object(agentPolicyShape).strict();

export const telegramChatIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/,
    "Use a numeric Chat ID or a channel username beginning with @."
  );

export const telegramBotTokenSchema = z
  .string()
  .trim()
  .min(20)
  .max(255)
  .regex(
    /^\d{6,12}:[A-Za-z0-9_-]{20,}$/,
    "Use the bot token supplied by BotFather."
  );

export const updatePlatformTelegramBodySchema = z
  .object({
    telegram_bot_token: telegramBotTokenSchema.nullable().optional(),
    telegram_chat_id: telegramChatIdSchema.nullable()
  })
  .strict();

export const createProjectBodySchema = z
  .object({
    name: z.string().trim().min(2).max(120)
  })
  .strict();

export const updateProjectBodySchema = createProjectBodySchema;

export const deleteProjectBodySchema = z
  .object({
    confirmation_name: z.string().min(2).max(120)
  })
  .strict();

const agentEditableShape = {
  server_name: z.string().trim().min(2).max(120),
  ...agentPolicyShape,
  telegram_alert_cooldown_seconds: z.number().int().min(300).max(86_400)
};

export const agentHealthApiUrlSchema = z.string().trim().url().max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}, "Use an HTTP(S) URL without embedded credentials.");
export const agentChecksSchema = z.object({
  apache: z.boolean(), nginx: z.boolean(), middleware_api: z.boolean()
}).strict();
export type AgentChecks = z.infer<typeof agentChecksSchema>;
export const DEFAULT_AGENT_CHECKS: AgentChecks = { apache: true, nginx: false, middleware_api: true };
const scriptConfigurationShape = {
  health_api_url: agentHealthApiUrlSchema.nullable(),
  // Compatibility: pre-1.3 callers omitted checks and always monitored Apache and the API.
  checks: agentChecksSchema.default(DEFAULT_AGENT_CHECKS)
};
function validScriptConfiguration(value: { health_api_url: string | null; checks: AgentChecks }): boolean {
  return value.checks.middleware_api ? value.health_api_url !== null : value.health_api_url === null;
}
export const generateAgentScriptBodySchema = z
  .object(scriptConfigurationShape).strict().refine(validScriptConfiguration, {
    message: "health_api_url is required when checks.middleware_api is enabled and must be null otherwise.", path: ["health_api_url"]
  });
export const createAgentInstallationBodySchema = z
  .object({ ...agentEditableShape, ...scriptConfigurationShape }).strict().refine(validScriptConfiguration, {
    message: "health_api_url is required when checks.middleware_api is enabled and must be null otherwise.", path: ["health_api_url"]
  });
export const updateAgentBodySchema = z.object(agentEditableShape).strict();
export type AgentEditableInput = z.infer<typeof updateAgentBodySchema>;

export const healthErrorCodeSchema = z.enum([
  "dns_error",
  "connection_error",
  "tls_error",
  "timeout",
  "http_status_error",
  "invalid_response",
  "unknown_error"
]);

export const healthProbeSchema = z
  .object({
    checked_at: z.number().int().nonnegative(),
    outcome: z.enum(["healthy", "unhealthy", "disabled"]),
    http_status_code: z.number().int().min(100).max(599).nullable(),
    latency_ms: z.number().int().nonnegative().max(300_000).nullable(),
    error_code: healthErrorCodeSchema.nullable(),
    error_message: z.string().max(500).nullable()
  })
  .strict().refine((value) => value.outcome !== "disabled" || (
    value.http_status_code === null && value.latency_ms === null && value.error_code === null && value.error_message === null
  ), { message: "Disabled checks must not include HTTP results." });

const nullableMetric = z.number().nonnegative().finite().nullable();

export const hostMetricsSchema = z
  .object({
    cpu_count: z.number().int().positive().max(65_536).nullable(),
    load_1: nullableMetric,
    load_5: nullableMetric,
    load_15: nullableMetric,
    memory_total_bytes: z.number().int().nonnegative().nullable(),
    memory_available_bytes: z.number().int().nonnegative().nullable(),
    swap_total_bytes: z.number().int().nonnegative().nullable(),
    swap_free_bytes: z.number().int().nonnegative().nullable(),
    uptime_seconds: z.number().int().nonnegative().nullable()
  })
  .strict();

export const filesystemMetricSchema = z
  .object({
    filesystem: z.string().min(1).max(255),
    mount_point: z.string().min(1).max(512),
    total_bytes: z.number().int().nonnegative(),
    available_bytes: z.number().int().nonnegative(),
    inode_used_percent: z.number().min(0).max(100).nullable()
  })
  .strict();

export const processMetricSchema = z
  .object({
    command: z.string().min(1).max(120),
    cpu_percent: z.number().min(0).max(100_000),
    memory_percent: z.number().min(0).max(100)
  })
  .strict();

export const serviceStatusSchema = z.enum(["active", "inactive", "unknown", "disabled"]);
export const serviceResultSchema = z.object({
  service_name: z.string().min(1).max(120), status: serviceStatusSchema
}).strict();
export const serviceCheckSchema = z
  .object({
    apache: serviceResultSchema,
    // Legacy agents do not send an Nginx result; normalize only at this boundary.
    nginx: serviceResultSchema.optional()
  })
  .strict();

export const telemetryPayloadSchema = z
  .object({
    sequence_id: z.number().int().nonnegative(),
    observed_at: z.number().int().nonnegative(),
    agent_version: z.string().min(1).max(40),
    health_probe: healthProbeSchema,
    metrics: hostMetricsSchema,
    filesystems: z.array(filesystemMetricSchema).max(32),
    top_processes: z.array(processMetricSchema).max(10),
    service_checks: serviceCheckSchema
  })
  .strict();

export type TelemetryPayload = z.infer<typeof telemetryPayloadSchema>;

export const agentHealthSnapshotSchema = z.object({
  apache: serviceResultSchema,
  nginx: serviceResultSchema,
  middleware_api: healthProbeSchema
}).strict();
export type AgentHealthSnapshot = z.infer<typeof agentHealthSnapshotSchema>;

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: InternalRole;
}

export interface SessionResponse {
  user: AuthenticatedUser;
  csrf_token: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  /** @deprecated Monitoring policy is agent-scoped. */
  ram_available_threshold_percent?: number;
  /** @deprecated Monitoring policy is agent-scoped. */
  disk_available_threshold_percent?: number;
  /** @deprecated Monitoring policy is agent-scoped. */
  load_5_per_core_threshold?: number;
  /** @deprecated Monitoring policy is agent-scoped. */
  heartbeat_interval_seconds?: number;
  healthy_agents: number;
  new_agents: number;
  warning_agents: number;
  critical_agents: number;
  stale_agents: number;
}

export interface PlatformTelegramSettings {
  telegram_bot_configured: boolean;
  telegram_chat_id: string | null;
}

export interface TelegramChatOption {
  id: string;
  name: string;
  type: "group" | "supergroup" | "channel";
}

export interface TelegramChatDiscovery {
  bot_username: string;
  chats: TelegramChatOption[];
}

export interface AgentSummary {
  id: string;
  server_name: string;
  health_api_url: string | null;
  /** Optional during rolling upgrades from the pre-1.3 API. */
  checks?: AgentChecks;
  status: "new" | "healthy" | "warning" | "critical" | "stale";
  probable_cause: string | null;
  last_heartbeat_at: number | null;
  last_metrics_at: number | null;
  agent_version: string | null;
  ram_available_percent: number | null;
  disk_available_percent: number | null;
  load_5_per_core: number | null;
  /** Raw five-minute load from the latest heartbeat; null when unavailable. */
  latest_load_5: number | null;
  health_outcome: "healthy" | "unhealthy" | "disabled" | null;
  health_http_status_code: number | null;
  health_latency_ms: number | null;
  ram_available_threshold_percent: number;
  disk_available_threshold_percent: number;
  load_5_per_core_threshold: number;
  heartbeat_interval_seconds: number;
  telegram_alert_cooldown_seconds: number;
}

export interface AgentInstallationResponse {
  agent_id: string;
  script_filename: string;
  script: string;
  crontab_entry: string;
  credential_shown_once: true;
}

export interface IncidentSummary {
  id: string;
  agent_id: string;
  server_name: string;
  incident_type: string;
  status: "open" | "resolved";
  opened_at: number;
  resolved_at: number | null;
  probable_cause: string;
}

export interface AgentIncidentLog extends IncidentSummary {
  severity: "warning" | "critical";
  details: unknown;
  last_notification_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TelegramDeliverySummary {
  id: string;
  event_type: "opened" | "resolved";
  incident_type: string;
  probable_cause: string;
  status: "pending" | "sent" | "failed";
  attempt_count: number;
  queued_at: number;
  next_attempt_at: number;
  sent_at: number | null;
  last_error: string | null;
}
