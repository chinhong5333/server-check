ALTER TABLE agents
  ADD COLUMN last_uptime_seconds BIGINT UNSIGNED NULL AFTER last_metrics_at,
  ADD COLUMN last_uptime_observed_at BIGINT UNSIGNED NULL AFTER last_uptime_seconds,
  ADD COLUMN last_uptime_received_at BIGINT UNSIGNED NULL AFTER last_uptime_observed_at;
