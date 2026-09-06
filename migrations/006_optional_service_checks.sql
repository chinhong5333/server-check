ALTER TABLE agents
  MODIFY COLUMN health_api_url VARCHAR(2048) NULL,
  ADD COLUMN check_configuration_json JSON NULL AFTER last_health_latency_ms,
  ADD COLUMN last_service_checks_json JSON NULL AFTER check_configuration_json;
