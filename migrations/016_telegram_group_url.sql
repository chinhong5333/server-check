ALTER TABLE platform_telegram_settings
  ADD COLUMN telegram_group_url VARCHAR(2048) NULL AFTER telegram_group_enabled;

UPDATE platform_telegram_settings
SET telegram_group_enabled = 0,
    updated_at = CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 AS UNSIGNED)
WHERE telegram_group_enabled <> 0;
