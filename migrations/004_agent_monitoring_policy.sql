ALTER TABLE agents
  ADD COLUMN ram_available_threshold_percent DECIMAL(5,2) NULL AFTER health_request_timeout_seconds,
  ADD COLUMN disk_available_threshold_percent DECIMAL(5,2) NULL AFTER ram_available_threshold_percent,
  ADD COLUMN load_5_per_core_threshold DECIMAL(10,3) NULL AFTER disk_available_threshold_percent,
  ADD COLUMN heartbeat_interval_seconds INT UNSIGNED NULL AFTER load_5_per_core_threshold;

UPDATE agents a
INNER JOIN projects p ON p.id = a.project_id
SET a.ram_available_threshold_percent = p.ram_available_threshold_percent,
    a.disk_available_threshold_percent = p.disk_available_threshold_percent,
    a.load_5_per_core_threshold = p.load_5_per_core_threshold,
    a.heartbeat_interval_seconds = p.heartbeat_interval_seconds
WHERE a.ram_available_threshold_percent IS NULL
   OR a.disk_available_threshold_percent IS NULL
   OR a.load_5_per_core_threshold IS NULL
   OR a.heartbeat_interval_seconds IS NULL;

ALTER TABLE agents
  MODIFY COLUMN ram_available_threshold_percent DECIMAL(5,2) NOT NULL,
  MODIFY COLUMN disk_available_threshold_percent DECIMAL(5,2) NOT NULL,
  MODIFY COLUMN load_5_per_core_threshold DECIMAL(10,3) NOT NULL,
  MODIFY COLUMN heartbeat_interval_seconds INT UNSIGNED NOT NULL;
