import { describe, expect, it } from "vitest";
import {
  decryptPlatformTelegramBotToken,
  encryptPlatformTelegramBotToken
} from "../../src/server/security/telegram-secrets.js";

describe("platform Telegram secret encryption", () => {
  const applicationSecret = "a".repeat(48);
  const botToken = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcd";

  it("round-trips a token without storing its plaintext", () => {
    const encrypted = encryptPlatformTelegramBotToken(applicationSecret, botToken);

    expect(encrypted).not.toContain(botToken);
    expect(decryptPlatformTelegramBotToken(applicationSecret, encrypted)).toBe(botToken);
  });
});
