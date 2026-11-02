import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { t } from "../i18n";

const clockFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

export function SidebarClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const time = clockFormat.format(now);
  return <time className="sidebar-clock numeric" dateTime={now.toISOString()} title={t("Local Time")}
    aria-label={t("Local Time: {0}", time)} aria-live="off"><Clock3 aria-hidden="true" />{time}</time>;
}
