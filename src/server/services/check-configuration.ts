import { agentChecksSchema, DEFAULT_AGENT_CHECKS, type AgentChecks, type TelemetryPayload } from "../../shared/contracts.js";

const CHECK_LABELS: Record<keyof AgentChecks, string> = { apache: "Apache", nginx: "Nginx", middleware_api: "Middleware API" };

/** Reads persisted configuration; NULL identifies an existing pre-1.3 installation. */
export function readAgentChecks(value: unknown): AgentChecks {
  if (value == null) return { ...DEFAULT_AGENT_CHECKS };
  return agentChecksSchema.parse(typeof value === "string" ? JSON.parse(value) : value);
}

/**
 * Names enabled checks the payload does not report. The server cannot make an installed script run a check,
 * so these require a regenerated script; extra reported checks are allowed and ignored by applyConfiguredChecks.
 */
export function missingConfiguredChecks(checks: AgentChecks, payload: TelemetryPayload): string[] {
  const reported: AgentChecks = {
    apache: payload.service_checks.apache.status !== "disabled",
    nginx: payload.service_checks.nginx != null && payload.service_checks.nginx.status !== "disabled",
    middleware_api: payload.health_probe.outcome !== "disabled"
  };
  return (Object.keys(CHECK_LABELS) as (keyof AgentChecks)[]).filter((key) => checks[key] && !reported[key]).map((key) => CHECK_LABELS[key]);
}

/** Treats results for checks turned off after the script was generated as disabled, so they are neither stored nor alerted. */
export function applyConfiguredChecks(checks: AgentChecks, payload: TelemetryPayload): TelemetryPayload {
  const { apache, nginx } = payload.service_checks;
  return {
    ...payload,
    service_checks: {
      apache: checks.apache ? apache : { ...apache, status: "disabled" },
      nginx: checks.nginx || !nginx ? nginx : { ...nginx, status: "disabled" }
    },
    ...(checks.middleware_api ? {} : {
      health_probe: { checked_at: payload.health_probe.checked_at, outcome: "disabled" as const,
        http_status_code: null, latency_ms: null, error_code: null, error_message: null },
      // Database health is reported by the middleware endpoint, so it is dropped with that check.
      database_health: null
    })
  };
}
