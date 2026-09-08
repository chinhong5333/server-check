ALTER TABLE heartbeat_events ADD INDEX idx_heartbeat_retention (received_at, id);
ALTER TABLE metric_samples ADD INDEX idx_metric_retention (received_at, id);
ALTER TABLE notification_outbox
  ADD INDEX idx_outbox_sent_retention (status, sent_at, id),
  ADD INDEX idx_outbox_failed_retention (status, updated_at, id),
  ADD INDEX idx_outbox_pending_age (status, created_at, id);
ALTER TABLE incidents ADD INDEX idx_incident_retention (status, resolved_at, id);
ALTER TABLE audit_events ADD INDEX idx_audit_retention (created_at, id);
