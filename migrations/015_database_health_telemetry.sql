ALTER TABLE metric_samples
  ADD COLUMN database_health_json JSON NULL AFTER health_error_message;
