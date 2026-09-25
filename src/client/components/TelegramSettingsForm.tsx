import { CircleAlert, List, Send } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  telegramBotTokenSchema,
  telegramChatIdSchema,
  telegramGroupUrlSchema,
  updatePlatformTelegramBodySchema,
  type PlatformTelegramSettings
} from "../../shared/contracts";
import { ApiError, apiFetch } from "../api";
import { InlineLoader } from "./Feedback";
import { useToast } from "./ToastProvider";
import { TelegramChatPicker } from "./TelegramChatPicker";
import { NotificationGroupSettings } from "./NotificationGroup";

export function TelegramSettingsForm({
  settings
}: {
  settings: PlatformTelegramSettings;
}) {
  const { showToast } = useToast();
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState(settings.telegram_chat_id ?? "");
  const [savedChatId, setSavedChatId] = useState(settings.telegram_chat_id);
  const [telegramGroupUrl, setTelegramGroupUrl] = useState(settings.telegram_group_url ?? "");
  const [savedGroupUrl, setSavedGroupUrl] = useState(settings.telegram_group_url);
  const [botConfigured, setBotConfigured] = useState(settings.telegram_bot_configured);
  const [savingSection, setSavingSection] = useState<"sender" | "destination" | null>(null);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tokenTouched, setTokenTouched] = useState(false);
  const [chatTouched, setChatTouched] = useState(false);
  const [groupUrlTouched, setGroupUrlTouched] = useState(false);
  const previousSettingsRef = useRef(settings);
  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  const chatPickerTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (previousSettingsRef.current === settings) return;
    previousSettingsRef.current = settings;
    setTelegramBotToken("");
    setTelegramChatId(settings.telegram_chat_id ?? "");
    setSavedChatId(settings.telegram_chat_id);
    setTelegramGroupUrl(settings.telegram_group_url ?? "");
    setSavedGroupUrl(settings.telegram_group_url);
    setBotConfigured(settings.telegram_bot_configured);
    setTokenTouched(false);
    setChatTouched(false);
    setGroupUrlTouched(false);
  }, [settings]);

  const normalizedBotToken = telegramBotToken.trim();
  const normalizedChatId = telegramChatId.trim() || null;
  const normalizedGroupUrl = telegramGroupUrl.trim() || null;
  const tokenValidation =
    normalizedBotToken.length === 0
      ? { success: true as const }
      : telegramBotTokenSchema.safeParse(normalizedBotToken);
  const chatValidation =
    normalizedChatId === null
      ? { success: true as const }
      : telegramChatIdSchema.safeParse(normalizedChatId);
  const groupUrlValidation = normalizedGroupUrl === null
    ? { success: true as const }
    : telegramGroupUrlSchema.safeParse(normalizedGroupUrl);
  const tokenError =
    tokenTouched && !tokenValidation.success
      ? "Use the bot token supplied by BotFather."
      : null;
  const chatError =
    chatTouched && !chatValidation.success
      ? "Use a numeric Chat ID or a channel username beginning with @."
      : null;
  const groupUrlError = groupUrlTouched && !groupUrlValidation.success
    ? "Use an HTTPS t.me group or invite link."
    : null;

  const savePlatformSender = async (event: FormEvent) => {
    event.preventDefault();
    setTokenTouched(true);
    const validation = updatePlatformTelegramBodySchema.safeParse({
      telegram_bot_token: normalizedBotToken,
      telegram_chat_id: savedChatId
    });
    if (!normalizedBotToken || !tokenValidation.success || !validation.success) {
      showToast({ tone: "error", message: "Enter a valid Telegram Bot Token." });
      return;
    }

    setSavingSection("sender");
    setMessage(null);
    try {
      await apiFetch<void>("/api/v1/settings/telegram", {
        method: "PATCH",
        body: JSON.stringify(validation.data)
      });
      setBotConfigured(true);
      setTelegramBotToken("");
      setMessage(null);
      showToast({ tone: "success", message: "Platform sender saved." });
    } catch (cause) {
      const nextMessage = cause instanceof ApiError ? cause.message : "The platform sender could not be saved.";
      setMessage(nextMessage);
      showToast({ tone: "error", message: nextMessage });
    } finally {
      setSavingSection(null);
    }
  };

  const saveAlertDestination = async (event: FormEvent) => {
    event.preventDefault();
    setChatTouched(true);
    setGroupUrlTouched(true);
    const validation = updatePlatformTelegramBodySchema.safeParse({
      telegram_chat_id: normalizedChatId,
      telegram_group_url: normalizedGroupUrl
    });
    if (!chatValidation.success || !groupUrlValidation.success || !validation.success) {
      showToast({ tone: "error", message: !chatValidation.success ? "Enter a valid Telegram Chat ID." : "Enter a valid Telegram Group Link." });
      return;
    }

    setSavingSection("destination");
    setMessage(null);
    try {
      await apiFetch<void>("/api/v1/settings/telegram", {
        method: "PATCH",
        body: JSON.stringify(validation.data)
      });
      setSavedChatId(normalizedChatId);
      setSavedGroupUrl(normalizedGroupUrl);
      setMessage(null);
      showToast({ tone: "success", message: "Alert destination saved." });
    } catch (cause) {
      const nextMessage = cause instanceof ApiError ? cause.message : "The alert destination could not be saved.";
      setMessage(nextMessage);
      showToast({ tone: "error", message: nextMessage });
    } finally {
      setSavingSection(null);
    }
  };

  const deliveryConfigured = botConfigured && savedChatId !== null;
  const destinationConfigured = savedChatId !== null;
  const hasUnsavedSender = normalizedBotToken.length > 0;
  const hasUnsavedGroupUrl = normalizedGroupUrl !== savedGroupUrl;
  const hasUnsavedDestination = normalizedChatId !== savedChatId || hasUnsavedGroupUrl;
  const hasUnsavedDeliveryChanges = hasUnsavedSender || normalizedChatId !== savedChatId;
  const saving = savingSection !== null;
  const senderSaveDisabled = saving || testing || !hasUnsavedSender || !tokenValidation.success;
  const destinationSaveDisabled = saving || testing || !hasUnsavedDestination || !chatValidation.success || !groupUrlValidation.success;
  const testMessageDisabled = saving || testing || !deliveryConfigured || hasUnsavedDeliveryChanges;
  const testMessageDisabledReason = saving
    ? "Disabled: Wait for the current save to finish."
    : testing
      ? "Sending the test message."
      : hasUnsavedSender
        ? "Disabled: Save Platform Sender changes first."
      : normalizedChatId !== savedChatId
          ? "Disabled: Save Alert Destination changes first."
          : !botConfigured
            ? "Disabled: Configure Platform Sender first."
            : !destinationConfigured
              ? "Disabled: Configure Alert Destination first."
              : null;

  const sendTestMessage = async () => {
    if (!deliveryConfigured || hasUnsavedDeliveryChanges) return;
    setTesting(true);
    setMessage(null);
    try {
      await apiFetch<void>("/api/v1/settings/telegram/test", { method: "POST" });
      showToast({ tone: "success", message: "Telegram test message sent." });
    } catch (cause) {
      const nextMessage = cause instanceof ApiError ? cause.message : "The Telegram test message could not be sent.";
      setMessage(nextMessage);
      showToast({ tone: "error", message: nextMessage });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="form-surface form-surface--wide" aria-labelledby="telegram-title">
      <div className="section-heading">
        <div>
          <h2 id="telegram-title">Telegram Alerts</h2>
          <p>Prepare one channel or group where Server Check sends every alert and recovery.</p>
        </div>
      </div>

      {message ? (
        <div className="form-banner form-banner--error" role="alert">
          {message}
        </div>
      ) : null}

      <div className="form-grid telegram-settings-grid">
        <form className="telegram-settings-form" onSubmit={savePlatformSender} noValidate aria-busy={savingSection === "sender"}>
          <fieldset className="form-section telegram-settings-section">
          <legend>Platform Sender</legend>
          <div className="field">
            <label htmlFor="platform-telegram-bot-token">Telegram Bot Token</label>
            <div className="telegram-control-row telegram-control-row--sender">
              <div className="telegram-control-feedback">
                <input
                  id="platform-telegram-bot-token"
                  type="password"
                  value={telegramBotToken}
                  onChange={(event) => setTelegramBotToken(event.target.value)}
                  onBlur={() => setTokenTouched(true)}
                  placeholder={botConfigured ? "Leave blank to keep the saved token" : "123456789:BotFatherToken"}
                  autoComplete="new-password"
                  aria-invalid={tokenError ? "true" : undefined}
                  aria-describedby="platform-telegram-token-help"
                />
                <span id="platform-telegram-token-help" className={`field__help${tokenError ? " field__help--error" : ""}`}>
                  {tokenError ?? (botConfigured ? "Leave blank to keep the existing encrypted token." : "Paste the token issued by BotFather for the platform bot.")}
                </span>
              </div>
              <button
                className="button button--primary telegram-section-action"
                type="submit"
                disabled={senderSaveDisabled}
              >
                {savingSection === "sender" ? <InlineLoader label="Saving Platform Sender" /> : "Save Platform Sender"}
              </button>
            </div>
          </div>
          </fieldset>
        </form>

        <form className="telegram-settings-form" onSubmit={saveAlertDestination} noValidate aria-busy={savingSection === "destination"}>
          <fieldset className="form-section telegram-settings-section">
          <legend>Alert Destination</legend>
          <div className="field">
            <div className="telegram-chat-field-heading">
              <label htmlFor="platform-telegram-chat-id">Telegram Chat ID</label>
              <button ref={chatPickerTriggerRef} className="button button--secondary" type="button"
                aria-haspopup="dialog" aria-controls="telegram-chat-picker"
                disabled={!botConfigured || hasUnsavedSender || saving || testing}
                title={!botConfigured || hasUnsavedSender ? "Save Platform Sender First" : "Select Telegram Chat"}
                onClick={() => setChatPickerOpen(true)}><List aria-hidden="true" />Select Telegram Chat</button>
            </div>
            <div className="telegram-control-row telegram-control-row--chat">
              <div className="telegram-control-feedback">
                <input
                  id="platform-telegram-chat-id"
                  value={telegramChatId}
                  onChange={(event) => setTelegramChatId(event.target.value)}
                  onBlur={() => setChatTouched(true)}
                  placeholder="@ops_alerts or -1001234567890"
                  autoComplete="off"
                  aria-invalid={chatError ? "true" : undefined}
                  aria-describedby="platform-telegram-chat-help"
                />
                <span id="platform-telegram-chat-help" className={`field__help${chatError ? " field__help--error" : ""}`}>
                  {chatError ?? "Use the channel username or the numeric ID of the prepared group."}
                </span>
              </div>
              <div className="telegram-action-feedback">
                <button
                  className="button button--secondary telegram-section-action"
                  type="button"
                  disabled={testMessageDisabled}
                  aria-describedby={testMessageDisabledReason ? "send-test-message-disabled-reason" : undefined}
                  onClick={() => void sendTestMessage()}
                >
                  <Send aria-hidden="true" />
                  {testing ? <InlineLoader label="Sending Test Message" /> : "Send Test Message"}
                </button>
                {testMessageDisabledReason ? (
                  <small id="send-test-message-disabled-reason" className="telegram-disabled-reason">
                    <CircleAlert aria-hidden="true" />
                    {testMessageDisabledReason}
                  </small>
                ) : null}
              </div>
            </div>
          </div>
          <div className="field telegram-group-link-field">
            <label htmlFor="platform-telegram-group-url">Telegram Group Link</label>
            <div className="telegram-control-row telegram-control-row--sender">
              <div className="telegram-control-feedback">
                <input id="platform-telegram-group-url" type="url" inputMode="url" autoComplete="off" spellCheck={false}
                  value={telegramGroupUrl} onChange={event => setTelegramGroupUrl(event.target.value)}
                  onBlur={() => setGroupUrlTouched(true)} placeholder="https://t.me/your_group or https://t.me/+invite"
                  aria-invalid={groupUrlError ? "true" : undefined} aria-describedby="platform-telegram-group-url-help" />
                <span id="platform-telegram-group-url-help" className={`field__help${groupUrlError ? " field__help--error" : ""}`}>
                  {groupUrlError ?? (savedGroupUrl ? "Shown to signed-in team members when enabled. This does not change where alerts are sent." : "Save a group link to make it available on the notification bar. Alert delivery uses the Chat ID above.")}
                </span>
              </div>
              <button className="button button--primary telegram-section-action" type="submit" disabled={destinationSaveDisabled}>
                {savingSection === "destination" ? <InlineLoader label="Saving Alert Destination" /> : "Save Alert Destination"}
              </button>
            </div>
            {savedGroupUrl ? <NotificationGroupSettings key={savedGroupUrl} linkAvailable={!hasUnsavedGroupUrl} /> : null}
          </div>
          </fieldset>
        </form>
      </div>
      <TelegramChatPicker open={chatPickerOpen} onClose={() => setChatPickerOpen(false)} restoreFocusTo={chatPickerTriggerRef.current}
        onSelect={(chat) => {
          setTelegramChatId(chat.id);
          setChatTouched(true);
          setMessage(null);
          setChatPickerOpen(false);
        }} />
    </section>
  );
}
