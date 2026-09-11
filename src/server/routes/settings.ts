import { Router } from "express";
import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import {
  updatePlatformTelegramBodySchema,
  type PlatformTelegramSettings
} from "../../shared/contracts.js";
import type { AppConfig } from "../config.js";
import { getPool, withTransaction } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import {
  decryptPlatformTelegramBotToken,
  encryptPlatformTelegramBotToken
} from "../security/telegram-secrets.js";
import { sendTelegramMessage } from "../services/telegram.js";
import { discoverTelegramChats, getTelegramBotLink } from "../services/telegram-chat-discovery.js";

const PLATFORM_SCOPE_KEY = "platform";
const emptyObjectSchema = z.object({}).strict();

interface PlatformTelegramRow extends RowDataPacket {
  id: string;
  telegram_bot_token_encrypted: string | null;
  telegram_chat_id: string | null;
  is_delete: number;
}

export function createSettingsRouter(config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(config));
  router.use(requirePermission("edit_global_settings"));

  /**
   * GET /api/v1/settings/telegram
   * Returns the platform Telegram delivery status without exposing the stored bot token.
   * Authorization: full admin or a sub-admin with edit_global_settings.
   * @param {import("express").Request} request Admin request; body and query must be empty.
   * @param {import("express").Response<PlatformTelegramSettings>} response Safe platform Telegram settings.
   * @returns {Promise<void>} Resolves after the platform settings lookup.
   */
  router.get(
    "/telegram",
    asyncHandler(async (_request, response) => {
      const [rows] = await getPool(config).execute<PlatformTelegramRow[]>(
        `SELECT id, telegram_bot_token_encrypted, telegram_chat_id, is_delete
         FROM platform_telegram_settings
         WHERE scope_key = ? AND is_delete = 0
         LIMIT 1`,
        [PLATFORM_SCOPE_KEY]
      );
      const row = rows[0];
      const payload: PlatformTelegramSettings = {
        telegram_bot_configured: Boolean(row?.telegram_bot_token_encrypted),
        telegram_chat_id: row?.telegram_chat_id ?? null
      };
      response.status(200).json(payload);
    })
  );

  /**
   * PATCH /api/v1/settings/telegram
   * Replaces the platform Telegram destination and optionally replaces or removes its encrypted bot token.
   * Authorization: full admin or a sub-admin with edit_global_settings.
   * @param {import("express").Request<{}, {}, import("zod").infer<typeof updatePlatformTelegramBodySchema>>} request Admin request.
   * @param {string|null} [request.body.telegram_bot_token] New BotFather token, null to remove it, or omitted to keep the existing encrypted token.
   * @param {string|null} request.body.telegram_chat_id Platform chat ID or channel username; null disables Telegram delivery.
   * @param {import("express").Response<void>} response Empty success response.
   * @returns {Promise<void>} Resolves after encrypted platform Telegram settings and audit persistence.
   */
  router.patch(
    "/telegram",
    requireCsrf,
    asyncHandler(async (request, response) => {
      const body = updatePlatformTelegramBodySchema.parse(request.body);
      const now = Date.now();

      await withTransaction(config, async (connection) => {
        const [rows] = await connection.execute<PlatformTelegramRow[]>(
          `SELECT id, telegram_bot_token_encrypted, telegram_chat_id, is_delete
           FROM platform_telegram_settings
           WHERE scope_key = ?
           LIMIT 1
           FOR UPDATE`,
          [PLATFORM_SCOPE_KEY]
        );
        const existing = rows[0];
        const encryptedBotToken =
          body.telegram_bot_token === undefined
            ? existing && existing.is_delete === 0
              ? existing.telegram_bot_token_encrypted
              : null
            : body.telegram_bot_token === null
              ? null
              : encryptPlatformTelegramBotToken(config.jwt.secret, body.telegram_bot_token);

        if (existing) {
          await connection.execute(
            `UPDATE platform_telegram_settings
             SET telegram_bot_token_encrypted = ?, telegram_chat_id = ?,
                 updated_at = ?, is_delete = 0
             WHERE id = ?`,
            [encryptedBotToken, body.telegram_chat_id, now, existing.id]
          );
        } else {
          await connection.execute(
            `INSERT INTO platform_telegram_settings
              (scope_key, telegram_bot_token_encrypted, telegram_chat_id,
               created_at, updated_at, is_delete)
             VALUES (?, ?, ?, ?, ?, 0)`,
            [PLATFORM_SCOPE_KEY, encryptedBotToken, body.telegram_chat_id, now, now]
          );
        }

        await connection.execute(
          `INSERT INTO audit_events
            (user_id, project_id, action, entity_type, entity_id, metadata_json,
             created_at, updated_at, is_delete)
           VALUES (?, NULL, 'platform.telegram.update', 'platform_setting', ?, ?, ?, ?, 0)`,
          [
            request.auth!.userInternalId,
            PLATFORM_SCOPE_KEY,
            JSON.stringify({
              telegram_bot_configured: encryptedBotToken !== null,
              telegram_chat_configured: body.telegram_chat_id !== null
            }),
            now,
            now
          ]
        );
      });

      response.status(204).send();
    })
  );

  /**
   * POST /api/v1/settings/telegram/test
   * Sends one test message through the saved platform Telegram Bot Token and Chat ID.
   * Authorization: full admin or a sub-admin with edit_global_settings.
   * @param {import("express").Request<{}, {}, Record<string, never>, Record<string, never>>} request Admin request; request body and query must be empty.
   * @param {import("express").Response<void>} response Empty success response after Telegram accepts the message.
   * @returns {Promise<void>} Resolves after configuration validation, credential decryption, and Telegram delivery.
   */
  router.post(
    "/telegram/test",
    requireCsrf,
    asyncHandler(async (request, response) => {
      emptyObjectSchema.parse(request.body ?? {});
      emptyObjectSchema.parse(request.query);
      const [rows] = await getPool(config).execute<PlatformTelegramRow[]>(
        `SELECT id, telegram_bot_token_encrypted, telegram_chat_id, is_delete
         FROM platform_telegram_settings
         WHERE scope_key = ? AND is_delete = 0
         LIMIT 1`,
        [PLATFORM_SCOPE_KEY]
      );
      const settings = rows[0];
      if (!settings?.telegram_bot_token_encrypted || !settings.telegram_chat_id) {
        throw new AppError(
          409,
          "telegram_not_configured",
          "Save both the Telegram Bot Token and Chat ID before sending a test message."
        );
      }

      const botToken = decryptPlatformTelegramBotToken(
        config.jwt.secret,
        settings.telegram_bot_token_encrypted
      );
      try {
        await sendTelegramMessage({
          botToken,
          chatId: settings.telegram_chat_id,
          text: `[TEST] Server Check\nPlatform Telegram delivery is configured and working.\nSent at: ${new Date().toISOString()}`
        });
      } catch {
        throw new AppError(
          502,
          "telegram_test_failed",
          "Telegram could not deliver the test message. Check the Bot Token, Chat ID, and bot access to the destination."
        );
      }

      response.status(204).send();
    })
  );

  /**
   * GET /api/v1/settings/telegram/chats
   * Discovers group/channel names and IDs from the saved platform bot's pending updates.
   * Authorization: full admin or a sub-admin with edit_global_settings.
   * @param {import("express").Request<{}, {}, Record<string, never>, Record<string, never>>} request Authenticated admin request; body and query must be empty. No token input is accepted.
   * @param {import("express").Response<import("../../shared/contracts.js").TelegramChatDiscovery>} response Bot username and chat id/name/type only, with Cache-Control: no-store.
   * @returns {Promise<void>} Returns 200 on discovery, 409 for missing/rejected bot configuration or webhook conflicts, 429 for request limits, or 502 for upstream failures. Does not save a destination, send messages, acknowledge updates, or alter webhooks.
   */
  router.get(
    "/telegram/chats",
    rateLimit({ windowMs: 60000, limit: 6, keyGenerator: (request) => request.auth!.userInternalId,
      standardHeaders: "draft-8", legacyHeaders: false,
      message: { error: { code: "telegram_discovery_rate_limited", message: "Please wait a minute before refreshing the chat list again." } } }),
    asyncHandler(async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      emptyObjectSchema.parse(request.body ?? {});
      emptyObjectSchema.parse(request.query);
      const [rows] = await getPool(config).execute<PlatformTelegramRow[]>(
        `SELECT id, telegram_bot_token_encrypted, telegram_chat_id, is_delete
         FROM platform_telegram_settings WHERE scope_key = ? AND is_delete = 0 LIMIT 1`, [PLATFORM_SCOPE_KEY]
      );
      if (!rows[0]?.telegram_bot_token_encrypted) {
        throw new AppError(409, "telegram_bot_not_configured", "Save the Platform Sender Bot Token before selecting a Telegram chat.");
      }
      const botToken = decryptPlatformTelegramBotToken(config.jwt.secret, rows[0].telegram_bot_token_encrypted);
      response.status(200).json(await discoverTelegramChats(botToken));
    })
  );

  /**
   * GET /api/v1/settings/telegram/bot-link
   * Resolves the saved platform bot's public chat link using Telegram getMe.
   * Authorization: full admin or a sub-admin with edit_global_settings.
   * @param {import("express").Request<{}, {}, Record<string, never>, Record<string, never>>} request Authenticated admin request; body and query must be empty. No token input is accepted.
   * @param {import("express").Response<{username: string, url: string}>} response Public bot username and HTTPS link only, with Cache-Control: no-store.
   * @returns {Promise<void>} Returns 200 on success, 409 for missing/rejected credentials, 429 for local request limits, or 502 for upstream failure. Does not send messages or modify settings.
   */
  router.get("/telegram/bot-link",
    rateLimit({ windowMs: 60000, limit: 6, keyGenerator: (request) => request.auth!.userInternalId,
      standardHeaders: "draft-8", legacyHeaders: false,
      message: { error: { code: "telegram_bot_link_rate_limited", message: "Please wait a minute before retrying the bot link." } } }),
    asyncHandler(async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      emptyObjectSchema.parse(request.body ?? {});
      emptyObjectSchema.parse(request.query);
      const [rows] = await getPool(config).execute<PlatformTelegramRow[]>(
        `SELECT id, telegram_bot_token_encrypted, telegram_chat_id, is_delete
         FROM platform_telegram_settings WHERE scope_key = ? AND is_delete = 0 LIMIT 1`, [PLATFORM_SCOPE_KEY]
      );
      if (!rows[0]?.telegram_bot_token_encrypted) {
        throw new AppError(409, "telegram_bot_not_configured", "Save the Platform Sender Bot Token to display its Telegram link.");
      }
      const token = decryptPlatformTelegramBotToken(config.jwt.secret, rows[0].telegram_bot_token_encrypted);
      response.status(200).json(await getTelegramBotLink(token));
    })
  );

  return router;
}
