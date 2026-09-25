import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatsFromUpdates, discoverTelegramChats } from "../../src/server/services/telegram-chat-discovery";
const token = "123456789:synthetic-token-for-test-only";
const fetchMock = vi.fn();
const result = (value: unknown) => new Response(JSON.stringify({ ok: true, result: value }), { status: 200 });
describe("Telegram chat discovery", () => {
  beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());
  it("deduplicates chat identities and excludes private chats and message contents", () => {
    const chats = chatsFromUpdates([
      { message: { chat: { id: -10, title: "Old Name", type: "group" }, text: "private message content" } },
      { message: { chat: { id: -10, title: "Operations", type: "group" } } },
      { channel_post: { chat: { id: -100123, title: "Alerts", type: "channel" } } },
      { message: { chat: { id: 99, type: "private", first_name: "Not Returned" } } },
      { message: { chat: { id: Number.MAX_SAFE_INTEGER + 1, title: "Invalid", type: "group" } } }
    ]);
    expect(chats).toEqual([{ id: "-100123", name: "Alerts", type: "channel" }, { id: "-10", name: "Operations", type: "group" }]);
  });
  it("handles group migrations and removes chats where the bot has left", () => {
    expect(chatsFromUpdates([
      { message: { chat: { id: -10, title: "Migrating", type: "group" }, migrate_to_chat_id: -100123 } },
      { my_chat_member: { chat: { id: -20, title: "Left Group", type: "group" }, new_chat_member: { status: "member" } } },
      { my_chat_member: { chat: { id: -20, title: "Left Group", type: "group" }, new_chat_member: { status: "left" } } }
    ])).toEqual([{ id: "-100123", name: "Migrating", type: "supergroup" }]);
  });
  it("reads pending updates without acknowledging them or changing update subscriptions", async () => {
    fetchMock.mockImplementation(async (url: string) => url.endsWith("getMe") ? result({ is_bot: true, username: "MonitorTestBot" })
      : url.endsWith("getWebhookInfo") ? result({ url: "" }) : result([]));
    expect(await discoverTelegramChats(token)).toEqual({ bot_username: "MonitorTestBot", chats: [] });
    const calls = fetchMock.mock.calls.map(([url]) => new URL(url));
    expect(calls).toHaveLength(3);
    const updates = calls.find(url => url.pathname.endsWith("getUpdates"))!;
    expect(updates.searchParams.get("limit")).toBe("100");
    expect(updates.searchParams.get("timeout")).toBe("0");
    expect(updates.searchParams.has("offset")).toBe(false);
    expect(updates.searchParams.has("allowed_updates")).toBe(false);
    expect(calls.every(url => !/sendMessage|setWebhook|deleteWebhook/.test(url.pathname))).toBe(true);
  });
  it("does not poll or disable an existing webhook", async () => {
    fetchMock.mockImplementation(async (url: string) => url.endsWith("getMe") ? result({ is_bot: true, username: "MonitorTestBot" }) : result({ url: "https://private.example/hook" }));
    await expect(discoverTelegramChats(token)).rejects.toMatchObject({ statusCode: 409, code: "telegram_webhook_active" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("sanitizes network failures containing the secret-bearing URL", async () => {
    fetchMock.mockRejectedValue(new Error(`Network failed: https://api.telegram.org/bot${token}/getMe`));
    try { await discoverTelegramChats(token); throw new Error("Expected rejection"); }
    catch (error) { expect(String(error)).not.toContain(token); expect(String(error)).toContain("Unable to load Telegram chats"); }
  });
  it("reports invalid tokens without exposing the credential", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: false, error_code: 401 }), { status: 401 }));
    await expect(discoverTelegramChats(token)).rejects.toMatchObject({ statusCode: 409, code: "telegram_bot_rejected" });
  });
});
