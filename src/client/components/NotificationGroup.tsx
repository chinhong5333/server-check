import { ExternalLink, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { telegramGroupUrlSchema } from "../../shared/contracts";
import { apiFetch } from "../api";
import { useToast } from "./ToastProvider";

const endpoint = "/api/v1/settings/telegram/group-link";
type GroupLink = { telegram_group_url: string | null; telegram_group_enabled: boolean };

export function NotificationGroupBar() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => void apiFetch<GroupLink>(endpoint, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setUrl(data.telegram_group_enabled && telegramGroupUrlSchema.safeParse(data.telegram_group_url).success ? data.telegram_group_url : null);
    }).catch(() => { if (!controller.signal.aborted) setUrl(null); });
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  if (!url) return null;
  return <aside className="notification-group-bar" aria-label="Telegram Notifications">
    <span><Send aria-hidden="true" />Access our Telegram alert destination.</span>
    <a href={url} target="_blank" rel="noopener noreferrer"><Send className="notification-group-bar__mobile-icon" aria-hidden="true" />Open Telegram Alerts<ExternalLink aria-hidden="true" /></a>
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
      setEnabled(!enabled); showToast({ tone: "success", message: "Notification bar visibility saved." });
    } catch { showToast({ tone: "error", message: "Could not save notification visibility. Try again." }); }
    finally { setSaving(false); }
  }
  if (!loaded) return null;
  return <div className="bot-link-visibility" aria-busy={saving || loading}>
    <button id="group-visibility-switch" className="bot-visibility-switch" type="button" role="switch"
      aria-label="Show on Notification Bar" title="Show Alert Destination Link To All Team Members" aria-checked={enabled}
      disabled={loading || saving || !loaded || (!linkAvailable && !enabled)} onClick={() => void toggle()}><span /></button>
    <label htmlFor="group-visibility-switch">Show on Notification Bar</label>
  </div>;
}
