ALTER TABLE platform_telegram_settings
  ADD COLUMN telegram_group_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER telegram_chat_id;
