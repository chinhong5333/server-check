ALTER TABLE maintenance_windows
  ADD COLUMN batch_id CHAR(36) NULL AFTER agent_id,
  ADD KEY idx_maintenance_batch (batch_id);
