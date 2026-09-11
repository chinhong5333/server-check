ALTER TABLE internal_users
  ADD COLUMN is_disabled TINYINT(1) NOT NULL DEFAULT 0 AFTER permissions_json;
