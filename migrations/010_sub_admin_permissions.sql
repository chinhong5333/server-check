ALTER TABLE internal_users
  MODIFY COLUMN role ENUM('admin', 'operator', 'sub_admin') NOT NULL,
  ADD COLUMN permissions_json JSON NULL AFTER role;
