ALTER TABLE agents
  ADD COLUMN telegram_alert_cooldown_seconds INT UNSIGNED NULL AFTER heartbeat_interval_seconds;

UPDATE agents
SET telegram_alert_cooldown_seconds = 900
WHERE telegram_alert_cooldown_seconds IS NULL;

ALTER TABLE agents
  MODIFY COLUMN telegram_alert_cooldown_seconds INT UNSIGNED NOT NULL;

ALTER TABLE notification_outbox
  ADD KEY idx_outbox_channel_status_sent (channel, status, sent_at, is_delete);
