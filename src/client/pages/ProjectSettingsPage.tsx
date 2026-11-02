import { SlidersHorizontal } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { updateProjectPolicyBodySchema } from "../../shared/contracts";
import { ApiError, apiFetch } from "../api";
import { EmptyState, ErrorState, InlineLoader, PageSkeleton } from "../components/Feedback";
import { useToast } from "../components/ToastProvider";
import { useProjects } from "../projects/ProjectProvider";
import { t } from "../i18n";

export function ProjectSettingsPage() {
  const { showToast } = useToast();
  const { selectedProject, status, error, reloadProjects } = useProjects();
  const [policy, setPolicy] = useState({ ram: "", disk: "", load: "", interval: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedProject) return;
    setPolicy({
      ram: String(selectedProject.ram_available_threshold_percent),
      disk: String(selectedProject.disk_available_threshold_percent),
      load: String(selectedProject.load_5_per_core_threshold),
      interval: String(selectedProject.heartbeat_interval_seconds)
    });
    setMessage(null);
  }, [selectedProject]);

  if (status === "loading") return <PageSkeleton rows={5} />;
  if (status === "error") {
    return <ErrorState title={t("Couldn't Load Projects")} message={error?.message ?? t("Try again.")} onRetry={reloadProjects} />;
  }
  if (!selectedProject) {
    return (
      <EmptyState
        title={t("Project Not Found")}
        message={t("Open a project before changing its settings.")}
        action={<Link className="button button--primary" to="/projects">{t("View Projects")}</Link>}
      />
    );
  }

  const savePolicy = async (event: FormEvent) => {
    event.preventDefault();
    const body = {
      ram_available_threshold_percent: Number(policy.ram),
      disk_available_threshold_percent: Number(policy.disk),
      load_5_per_core_threshold: Number(policy.load),
      heartbeat_interval_seconds: Number(policy.interval)
    };
    const validation = updateProjectPolicyBodySchema.safeParse(body);
    if (!validation.success) {
      const nextMessage = t("Complete every policy field with a value inside its documented range.");
      setMessage(nextMessage);
      showToast({ tone: "error", message: nextMessage });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch<void>(`/api/v1/projects/${selectedProject.id}/policy`, {
        method: "PATCH",
        body: JSON.stringify(validation.data)
      });
      setMessage(null);
      reloadProjects();
      showToast({ tone: "success", message: t("Project settings saved.") });
    } catch (cause) {
      const nextMessage = cause instanceof ApiError ? cause.message : t("The threshold settings could not be saved.");
      setMessage(nextMessage);
      showToast({ tone: "error", message: nextMessage });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-context">{selectedProject.name}</p>
          <h1>{t("Project Setting")}</h1>
          <p>{t("Manage monitoring thresholds and heartbeat timing for this project.")}</p>
        </div>
        <SlidersHorizontal aria-hidden="true" />
      </header>

      <section className="form-surface form-surface--wide" aria-labelledby="policy-title">
        <div className="section-heading">
          <div>
            <h2 id="policy-title">{t("Project Thresholds")}</h2>
            <p>{t("Changes apply to subsequent central evaluations for all registered agents.")}</p>
          </div>
        </div>
        {message ? (
          <div className="form-banner form-banner--error" role="alert">
            {message}
          </div>
        ) : null}
        <form className="form-grid" onSubmit={savePolicy} noValidate aria-busy={saving}>
          <div className="field">
            <label htmlFor="policy-ram">{t("RAM Available Below (%)")}</label>
            <input id="policy-ram" inputMode="decimal" value={policy.ram} onChange={(event) => setPolicy((value) => ({ ...value, ram: event.target.value }))} required />
            <span className="field__help">{t("Range: 0.1–99.9.")}</span>
          </div>
          <div className="field">
            <label htmlFor="policy-disk">{t("Storage Available Below (%)")}</label>
            <input id="policy-disk" inputMode="decimal" value={policy.disk} onChange={(event) => setPolicy((value) => ({ ...value, disk: event.target.value }))} required />
            <span className="field__help">{t("Evaluated per filesystem.")}</span>
          </div>
          <div className="field">
            <label htmlFor="policy-load">{t("5-Minute Load Per Core")}</label>
            <input id="policy-load" inputMode="decimal" value={policy.load} onChange={(event) => setPolicy((value) => ({ ...value, load: event.target.value }))} required />
            <span className="field__help">{t("Normalized by logical CPU count.")}</span>
          </div>
          <div className="field">
            <label htmlFor="policy-interval">{t("Heartbeat Interval")}</label>
            <select id="policy-interval" value={policy.interval} onChange={(event) => setPolicy((value) => ({ ...value, interval: event.target.value }))} required>
              {[1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60].map((minutes) => (
                <option value={minutes * 60} key={minutes}>{t("{0} min", minutes)}</option>
              ))}
            </select>
            <span className="field__help">{t("New generated scripts use this schedule.")}</span>
          </div>
          <button className="button button--primary field--wide" type="submit" disabled={saving}>
            {saving ? <InlineLoader label={t("Saving Thresholds")} /> : t("Save Thresholds")}
          </button>
        </form>
      </section>
    </div>
  );
}
