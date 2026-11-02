import { RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TelegramChatDiscovery, TelegramChatOption } from "../../shared/contracts";
import { ApiError, apiFetch } from "../api";
import { InlineLoader } from "./Feedback";
import { ModalDialog } from "./ModalDialog";
import { t } from "../i18n";

const typeLabels = { get group() { return t("Group"); }, get supergroup() { return t("Supergroup"); }, get channel() { return t("Channel"); } };

export function TelegramChatPicker({ open, onClose, onSelect, restoreFocusTo }: {
  open: boolean; onClose: () => void; onSelect: (chat: TelegramChatOption) => void; restoreFocusTo: HTMLElement | null;
}) {
  const [data, setData] = useState<TelegramChatDiscovery | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<TelegramChatDiscovery>("/api/v1/settings/telegram/chats", { signal: controller.signal });
      if (!controller.signal.aborted) setData(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : t("The chat list could not be loaded. Try refreshing it."));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    setData(null);
    void refresh();
    return () => requestRef.current?.abort();
  }, [open, refresh]);

  return <ModalDialog id="telegram-chat-picker" open={open} labelledBy="telegram-chat-picker-title"
    describedBy="telegram-chat-picker-guide" dialogClassName="agent-dialog--telegram-chats"
    surfaceClassName="agent-dialog__surface data-surface telegram-chat-picker" restoreFocusTo={restoreFocusTo}>
    <header className="section-heading">
      <h2 id="telegram-chat-picker-title">{t("Select Telegram Chat")}</h2>
      <button className="icon-button" type="button" aria-label={t("Close Telegram Chat Selection")} onClick={onClose} data-dialog-initial-focus>
        <X aria-hidden="true" />
      </button>
    </header>
    <div className="telegram-chat-picker__content">
      <p id="telegram-chat-picker-guide" className="telegram-chat-picker__guide">
        {t("Send")}{" "}<code>/start@{data?.bot_username ?? "YourBotUsername"}</code>{" "}{t("in your Telegram group first, then click")}{" "}<strong>{t("Refresh List")}</strong>{" "}{t("to load its chat name and ID.")}
      </p>
      <div className="telegram-chat-picker__toolbar">
        <span className="field__help">{data && !error ? t(data.chats.length === 1 ? "Total {0} Chat" : "Total {0} Chats", data.chats.length) : t("Available Chats")}</span>
        <button className="button button--secondary" type="button" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" />{loading ? <InlineLoader label={t("Loading Chats")} /> : t("Refresh List")}
        </button>
      </div>
      {error ? <p className="form-banner form-banner--error" role="alert">{error}</p> : null}
      {!error && data?.chats.length ? <div className="telegram-chat-picker__list" aria-busy={loading}>
        <table className="telegram-chat-picker__table">
          <caption className="visually-hidden">{t("Discoverable Telegram Groups And Channels")}</caption>
          <thead><tr><th scope="col">{t("Chat Name")}</th><th scope="col">{t("Type")}</th><th scope="col">{t("Chat ID")}</th><th scope="col"><span className="visually-hidden">{t("Actions")}</span></th></tr></thead>
          <tbody>{data.chats.map(chat => <tr key={chat.id}>
            <td data-label={t("Chat Name")}><strong>{chat.name}</strong></td>
            <td data-label={t("Type")}>{typeLabels[chat.type]}</td>
            <td data-label={t("Chat ID")}><code>{chat.id}</code></td>
            <td data-label={t("Actions")}><button className="button button--secondary" type="button" disabled={loading}
              aria-label={t("Select {0}, {1}", chat.name, chat.id)} onClick={() => onSelect(chat)}>{t("Select")}</button></td>
          </tr>)}</tbody>
        </table>
      </div> : !error && !loading && data ? <p className="quiet-message" role="status">{t("No chats are available yet. Send the group command above, then refresh the list.")}</p> : null}
      <p className="field__help">{t("Only groups and channels present in the bot’s available updates can be listed. Selecting a chat fills the field; Save Alert Destination applies the change.")}</p>
    </div>
  </ModalDialog>;
}
