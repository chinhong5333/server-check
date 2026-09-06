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
  if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}.`);
}
