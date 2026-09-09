ALTER TABLE notification_outbox
  ADD COLUMN alert_key CHAR(64) NULL AFTER payload_json,
  ADD INDEX idx_outbox_pending_identity (incident_id, channel, event_type, status, is_delete, alert_key);
