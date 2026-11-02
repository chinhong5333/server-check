import { ArrowLeft, BellRing } from "lucide-react";
import { useCallback } from "react";
import { Link } from "react-router-dom";
import type { PlatformTelegramSettings } from "../../shared/contracts";
import { apiFetch } from "../api";
import { ErrorState, PageSkeleton } from "../components/Feedback";
import { TelegramSettingsForm } from "../components/TelegramSettingsForm";
import { useApiResource } from "../hooks/useApiResource";
import { useAuth } from "../auth/AuthProvider";
import { hasPermission } from "../../shared/permissions";
import { t } from "../i18n";

export function PlatformSettingsPage() {
  const { user } = useAuth();
  const loadSettings = useCallback(
    () => apiFetch<PlatformTelegramSettings>("/api/v1/settings/telegram"),
    []
  );
  const resource = useApiResource("platform-telegram-settings", loadSettings);

  return (
    <div className="page-stack">
      <div className="settings-page-intro">
      {hasPermission(user, "view_projects") && <Link className="back-link" to="/projects"><ArrowLeft aria-hidden="true" />{" "}{t("Back To Projects")}</Link>}
      <header className="page-header">
        <div>
          <p className="page-context">{t("Platform")}</p>
          <h1>{t("Telegram")}</h1>
          <p>{t("Configure the shared alert destination used for incidents from every project.")}</p>
        </div>
        <BellRing aria-hidden="true" />
      </header>
      </div>

      {resource.status === "loading" ? <PageSkeleton rows={4} /> : resource.status === "error" || !resource.data ? (
        <ErrorState
          title={t("Couldn't Load Platform Settings")}
          message={resource.error?.message ?? t("Try again.")}
          onRetry={resource.reload}
        />
      ) : <TelegramSettingsForm settings={resource.data} />}
    </div>
  );
}
