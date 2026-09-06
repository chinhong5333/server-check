CREATE TABLE IF NOT EXISTS platform_telegram_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope_key VARCHAR(20) NOT NULL,
  telegram_bot_token_encrypted VARCHAR(1024) NULL,
  telegram_chat_id VARCHAR(64) NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  is_delete TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_platform_telegram_scope (scope_key),
  KEY idx_platform_telegram_active (is_delete, scope_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
