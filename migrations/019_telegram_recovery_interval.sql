ALTER TABLE agents
  ADD COLUMN telegram_recovery_cooldown_seconds INT UNSIGNED NOT NULL DEFAULT 30
  AFTER telegram_alert_cooldown_seconds;

CREATE TABLE telegram_delivery_state (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope_key VARCHAR(20) NOT NULL,
  next_delivery_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
  blocked_until BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  is_delete TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_telegram_delivery_scope (scope_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_outbox_event_sent
  ON notification_outbox (channel, status, event_type, is_delete, sent_at, incident_id);
