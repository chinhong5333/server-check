import { ExternalLink, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { telegramGroupUrlSchema } from "../../shared/contracts";
import { apiFetch } from "../api";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useToast } from "./ToastProvider";
import { t } from "../i18n";

const endpoint = "/api/v1/settings/telegram/group-link";
type GroupLink = { telegram_group_url: string | null; telegram_group_enabled: boolean };

/** Desktop shows the link in the sidebar; narrower screens keep the bar at the top of the page. */
export function NotificationGroupBar({ placement = "page" }: { placement?: "page" | "sidebar" }) {
  const desktop = useMediaQuery("(min-width: 60rem)");
  const active = placement === "sidebar" ? desktop : !desktop;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!active) { setUrl(null); return; }
    const controller = new AbortController();
    const refresh = () => void apiFetch<GroupLink>(endpoint, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setUrl(data.telegram_group_enabled && telegramGroupUrlSchema.safeParse(data.telegram_group_url).success ? data.telegram_group_url : null);
    }).catch(() => { if (!controller.signal.aborted) setUrl(null); });
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [active]);
  if (!active || !url) return null;
  if (placement === "sidebar") {
    return <a className="sidebar-alert-link" href={url} target="_blank" rel="noopener noreferrer" aria-label={t("Open Telegram Alerts")}>
      <span className="sidebar-alert-link__icon" aria-hidden="true"><Send /></span>
      <span className="sidebar-alert-link__text"><strong>{t("Telegram Alerts")}</strong><small>{t("Alert Destination")}</small></span>
      <ExternalLink aria-hidden="true" />
    </a>;
  }
  return <aside className="notification-group-bar" aria-label={t("Telegram Notifications")}>
    <span><Send aria-hidden="true" />{t("Access our Telegram alert destination.")}</span>
    <a href={url} target="_blank" rel="noopener noreferrer"><Send className="notification-group-bar__mobile-icon" aria-hidden="true" />{t("Open Telegram Alerts")}<ExternalLink aria-hidden="true" /></a>
  </aside>;
}

export function NotificationGroupSettings({ linkAvailable }: { linkAvailable: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { showToast } = useToast();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void apiFetch<GroupLink>(endpoint, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setEnabled(data.telegram_group_enabled); setLoaded(true); }
    }).catch(() => { if (!controller.signal.aborted) setLoaded(false); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  async function toggle() {
    if (saving || loading || !loaded) return;
    setSaving(true);
    try {
      await apiFetch(endpoint, { method: "PATCH", body: JSON.stringify({ telegram_group_enabled: !enabled }) });
      setEnabled(!enabled); showToast({ tone: "success", message: t("Notification bar visibility saved.") });
    } catch { showToast({ tone: "error", message: t("Could not save notification visibility. Try again.") }); }
    finally { setSaving(false); }
  }
  if (!loaded) return null;
  return <div className="bot-link-visibility" aria-busy={saving || loading}>
    <button id="group-visibility-switch" className="bot-visibility-switch" type="button" role="switch"
      aria-label={t("Show on Notification Bar")} title={t("Show Alert Destination Link To All Team Members")} aria-checked={enabled}
      disabled={loading || saving || !loaded || (!linkAvailable && !enabled)} onClick={() => void toggle()}><span /></button>
    <label htmlFor="group-visibility-switch">{t("Show on Notification Bar")}</label>
  </div>;
}
