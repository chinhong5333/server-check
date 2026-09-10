import { z } from "zod";
import type { TelegramChatDiscovery, TelegramChatOption } from "../../shared/contracts.js";
import { AppError } from "../errors.js";

const chatId = z.number().int().safe();
const chatSchema = z.object({ id: chatId, type: z.enum(["private", "group", "supergroup", "channel"]), title: z.string().max(256).optional() });
const messageSchema = z.object({ chat: chatSchema, migrate_to_chat_id: chatId.optional() });
const updateSchema = z.object({
  message: messageSchema.optional(), edited_message: messageSchema.optional(),
  channel_post: messageSchema.optional(), edited_channel_post: messageSchema.optional(),
  my_chat_member: z.object({ chat: chatSchema, new_chat_member: z.object({ status: z.string() }) }).optional()
});

/** Extracts group/channel identity only; message contents and private conversations are never returned. */
export function chatsFromUpdates(updates: unknown[]): TelegramChatOption[] {
  const chats = new Map<string, TelegramChatOption>();
  const migrated = new Set<string>();
  const add = (chat: z.infer<typeof chatSchema>) => {
    if (chat.type === "private" || chat.id >= 0 || !chat.title) return;
    chats.set(String(chat.id), { id: String(chat.id), name: chat.title, type: chat.type });
  };
  for (const value of updates) {
    const parsed = updateSchema.safeParse(value);
    if (!parsed.success) continue;
    const update = parsed.data;
    for (const message of [update.message, update.edited_message, update.channel_post, update.edited_channel_post]) {
      if (!message) continue;
      if (message.migrate_to_chat_id && message.migrate_to_chat_id < 0) {
        migrated.add(String(message.chat.id));
        add({ ...message.chat, id: message.migrate_to_chat_id, type: "supergroup" });
      } else add(message.chat);
    }
    if (update.my_chat_member) {
      const member = update.my_chat_member;
      if (["left", "kicked"].includes(member.new_chat_member.status)) chats.delete(String(member.chat.id));
      else add(member.chat);
    }
  }
  for (const id of migrated) chats.delete(id);
  return [...chats.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

async function telegramResult(botToken: string, method: "getMe" | "getWebhookInfo" | "getUpdates"): Promise<unknown> {
  const query = method === "getUpdates" ? "?limit=100&timeout=0" : "";
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}${query}`, {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(8000)
  });
  const payload = z.object({ ok: z.boolean(), result: z.unknown().optional(), error_code: z.number().optional() })
    .parse(await response.json());
  if (!response.ok || !payload.ok) {
    const code = payload.error_code ?? response.status;
    if ([401, 403, 404].includes(code)) throw new AppError(409, "telegram_bot_rejected", "Telegram rejected the saved Bot Token. Check Platform Sender and save a valid token.");
    if (code === 409) throw new AppError(409, "telegram_updates_conflict", "Another bot integration or webhook is receiving updates. Enter the Chat ID manually or obtain it from that integration.");
    if (code === 429) throw new AppError(429, "telegram_rate_limited", "Telegram is limiting requests. Wait before refreshing the list again.");
    throw new AppError(502, "telegram_discovery_failed", "Telegram could not return the chat list. Try again shortly.");
  }
  return payload.result;
}

/**
 * Looks up the saved bot's public identity without reading chats or sending messages.
 * @param {string} botToken Decrypted server-only BotFather credential.
 * @returns {Promise<{username: string, url: string}>} Validated public username and HTTPS bot-chat link.
 */
export async function getTelegramBotLink(botToken: string): Promise<{ username: string; url: string }> {
  try {
    const bot = z.object({ is_bot: z.literal(true), username: z.string().regex(/^[A-Za-z0-9_]{5,32}$/) })
      .parse(await telegramResult(botToken, "getMe"));
    return { username: bot.username, url: `https://t.me/${bot.username}` };
  } catch (error) {
    if (error instanceof AppError && error.code === "telegram_bot_rejected") throw error;
    // Neither raw fetch errors nor Telegram responses may expose credential-bearing URLs.
    throw new AppError(502, "telegram_bot_link_unavailable", "Unable to load the Telegram bot link. Check the saved token and try again.");
  }
}

/**
 * Discovers chats from at most 100 available updates using the saved platform bot.
 * @param {string} botToken Decrypted server-only BotFather credential.
 * @returns {Promise<TelegramChatDiscovery>} Bot username and deduplicated group/channel names and IDs.
 * No offset or allowed_updates is supplied, so updates are not acknowledged or reconfigured.
 * An active webhook is left untouched and reported as a conflict.
 */
export async function discoverTelegramChats(botToken: string): Promise<TelegramChatDiscovery> {
  try {
    const [me, webhook] = await Promise.all([telegramResult(botToken, "getMe"), telegramResult(botToken, "getWebhookInfo")]);
    const bot = z.object({ is_bot: z.literal(true), username: z.string().regex(/^[A-Za-z0-9_]{5,32}$/) }).parse(me);
    const hook = z.object({ url: z.string() }).parse(webhook);
    if (hook.url) throw new AppError(409, "telegram_webhook_active", "This bot has an active webhook. Enter the Chat ID manually or obtain it from the webhook integration. Its webhook has not been changed.");
    const updates = z.array(z.unknown()).max(100).parse(await telegramResult(botToken, "getUpdates"));
    return { bot_username: bot.username, chats: chatsFromUpdates(updates) };
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Fetch errors can contain the credential-bearing URL; never propagate them.
    throw new AppError(502, "telegram_discovery_unavailable", "Unable to load Telegram chats. Check the saved bot configuration and network connection, then try again.");
  }
}
