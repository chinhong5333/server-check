import { ArrowLeft, BellRing } from "lucide-react";
import { useCallback } from "react";
import { Link } from "react-router-dom";
import type { PlatformTelegramSettings } from "../../shared/contracts";
import { apiFetch } from "../api";
import { ErrorState, PageSkeleton } from "../components/Feedback";
import { TelegramSettingsForm } from "../components/TelegramSettingsForm";
import { useApiResource } from "../hooks/useApiResource";

export function PlatformSettingsPage() {
  const loadSettings = useCallback(
    () => apiFetch<PlatformTelegramSettings>("/api/v1/settings/telegram"),
    []
  );
  const resource = useApiResource("platform-telegram-settings", loadSettings);

  return (
    <div className="page-stack">
      <div className="settings-page-intro">
      <Link className="back-link" to="/projects"><ArrowLeft aria-hidden="true" /> Back To Projects</Link>
      <header className="page-header">
        <div>
          <p className="page-context">Platform</p>
          <h1>Setting</h1>
          <p>Configure the shared alert destination used for incidents from every project.</p>
        </div>
        <BellRing aria-hidden="true" />
      </header>
      </div>

      {resource.status === "loading" ? <PageSkeleton rows={4} /> : resource.status === "error" || !resource.data ? (
        <ErrorState
          title="Couldn't Load Platform Settings"
          message={resource.error?.message ?? "Try again."}
          onRetry={resource.reload}
        />
      ) : <TelegramSettingsForm settings={resource.data} />}
    </div>
  );
}
