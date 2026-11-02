import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { AdminManagement } from "../components/AdminManagement";
import { t } from "../i18n";

export function AdminManagementPage() {
  return <div className="page-stack">
    <div className="settings-page-intro">
      <Link className="back-link" to="/projects"><ArrowLeft aria-hidden="true" />{" "}{t("Back To Projects")}</Link>
      <header className="page-header"><div><h1>{t("Teams")}</h1>
        <p>{t("Manage admins, sub-admins, and their assigned permissions.")}</p></div></header>
    </div>
    <AdminManagement />
  </div>;
}
