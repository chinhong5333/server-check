ALTER TABLE projects ADD COLUMN sort_order INT UNSIGNED NOT NULL DEFAULT 0 AFTER heartbeat_grace_seconds;
ALTER TABLE projects ADD INDEX idx_projects_sort (is_delete, sort_order, name, id);
