ALTER TABLE agents
  ADD COLUMN middleware_failure_threshold INT UNSIGNED NOT NULL DEFAULT 2 AFTER telegram_alert_cooldown_seconds,
  ADD COLUMN middleware_failure_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER middleware_failure_threshold;
