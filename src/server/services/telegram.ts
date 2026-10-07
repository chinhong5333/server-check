/** Telegram flood-control metadata, without retaining bot credentials or response bodies. */
export class TelegramDeliveryError extends Error {
  constructor(public readonly statusCode: number, public readonly retryAfterSeconds: number | null = null) {
    super(`Telegram returned error ${statusCode}.`);
    this.name = "TelegramDeliveryError";
  }
}

/**
 * POST https://api.telegram.org/bot<token>/sendMessage
 * Delivers plain text and validates Telegram's canonical acknowledgement and flood-control fields.
 * @param {object} input Telegram delivery inputs.
 * @param {string} input.botToken Platform bot credential; never included in thrown diagnostics.
 * @param {string} input.chatId Configured destination identifier.
 * @param {string} input.text Plain message text, limited to 4096 characters.
 * @returns {Promise<void>} Resolves only for a successful Telegram acknowledgement.
 */
export async function sendTelegramMessage({
  botToken,
  chatId,
  text
}: {
  botToken: string;
  chatId: string;
  text: string;
}): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
      signal: AbortSignal.timeout(10_000)
    }
  );
  const body: unknown = await response.json().catch(() => null);
  const result = body !== null && typeof body === "object" ? body as { ok?: unknown; error_code?: unknown; parameters?: { retry_after?: unknown } } : null;
  if (!response.ok || result?.ok !== true) {
    const status = typeof result?.error_code === "number" && Number.isInteger(result.error_code) ? result.error_code : response.status;
    const retry = result?.parameters?.retry_after;
    const retryAfter = typeof retry === "number" && Number.isSafeInteger(retry) && retry > 0 && retry <= 31_536_000 ? retry : null;
    throw new TelegramDeliveryError(status, retryAfter);
  }
}
