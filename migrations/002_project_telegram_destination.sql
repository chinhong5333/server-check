ALTER TABLE projects
  ADD COLUMN telegram_bot_token_encrypted VARCHAR(1024) NULL AFTER heartbeat_grace_seconds,
  ADD COLUMN telegram_chat_id VARCHAR(64) NULL AFTER telegram_bot_token_encrypted;
