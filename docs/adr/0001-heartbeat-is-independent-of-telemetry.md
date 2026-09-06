---
status: accepted
---

# Heartbeat is independent of telemetry validity

An authenticated call from a registered agent counts as a heartbeat whether its body is absent, valid, or invalid, while only a valid payload becomes a metric sample. This deliberately separates connectivity from telemetry freshness: the system can show that an agent is online while also reporting that its metrics are absent, stale, or invalid, instead of incorrectly declaring the whole server unreachable.

## Consequences

- Monitored servers require separate `last_heartbeat_at` and `last_metrics_at` values.
- An invalid non-empty payload produces a validation error without erasing the fact that the authenticated agent reached the service.
- The admin panel and alert evaluator must treat liveness failure and telemetry staleness as distinct conditions.
- Failed authentication or an unknown, revoked, or deleted agent never updates either timestamp.

