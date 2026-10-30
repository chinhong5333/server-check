import { agentChecksSchema, DEFAULT_AGENT_CHECKS, type AgentChecks, type TelemetryPayload } from "../../shared/contracts.js";

/** Reads persisted configuration; NULL identifies an existing pre-1.3 installation. */
export function readAgentChecks(value: unknown): AgentChecks {
  if (value == null) return { ...DEFAULT_AGENT_CHECKS };
  return agentChecksSchema.parse(typeof value === "string" ? JSON.parse(value) : value);
}

/**
 * Treats results for checks turned off after the script was generated as disabled, so they are neither stored nor alerted.
 * A check turned on that the installed script does not run stays "disabled" as reported; the UI shows it as Needs New Script.
 */
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
