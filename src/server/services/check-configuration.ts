import { agentChecksSchema, DEFAULT_AGENT_CHECKS, type AgentChecks, type TelemetryPayload } from "../../shared/contracts.js";

/** Reads persisted configuration; NULL identifies an existing pre-1.3 installation. */
export function readAgentChecks(value: unknown): AgentChecks {
  if (value == null) return { ...DEFAULT_AGENT_CHECKS };
  return agentChecksSchema.parse(typeof value === "string" ? JSON.parse(value) : value);
}

/** Prevents a payload from silently disabling checks selected in its generated script. */
export function matchesConfiguredChecks(checks: AgentChecks, payload: TelemetryPayload): boolean {
  return checks.apache === (payload.service_checks.apache.status !== "disabled")
    && checks.nginx === (payload.service_checks.nginx != null && payload.service_checks.nginx.status !== "disabled")
    && checks.middleware_api === (payload.health_probe.outcome !== "disabled");
}
