import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { InlineLoader } from "./Feedback";

/** Displays only the public bot URL; saved credentials are resolved by the admin-only backend. */
export function TelegramBotLink() {
  const [link, setLink] = useState<{ username: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLink(null); setError(null);
    void apiFetch<{ username: string; url: string }>("/api/v1/settings/telegram/bot-link", { signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        if (!/^[A-Za-z0-9_]{5,32}$/.test(value.username) || value.url !== `https://t.me/${value.username}`) {
          throw new Error("Invalid bot link");
        }
        setLink(value);
      })
      .catch(() => { if (!controller.signal.aborted) setError("Unable to load the bot link. Check the saved token or try again shortly."); });
    return () => controller.abort();
  }, [attempt]);
  return <div className="telegram-bot-link">
    <span className="field__label">Telegram Bot Link</span>
    {link ? <a href={link.url} target="_blank" rel="noopener noreferrer" title={link.url}
      aria-label={`Open Telegram Bot @${link.username} In A New Tab`}><span>{link.url}</span><ExternalLink aria-hidden="true" /></a>
      : error ? <div><p className="field__help field__help--error" role="status">{error}</p>
        <button type="button" className="button button--secondary" onClick={() => setAttempt(value => value + 1)}>Retry Bot Link</button></div>
        : <span role="status"><InlineLoader label="Loading Bot Link" /></span>}
  </div>;
}
