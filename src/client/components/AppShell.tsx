import { hasPermission } from "../../shared/permissions";
import {
  Activity,
  BellRing,
  KeyRound,
  Users,
  ArrowLeftRight,
  LogOut,
  Menu,
  Settings,
  WifiOff,
  X
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useProjects } from "../projects/ProjectProvider";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import { SidebarClock } from "./SidebarClock";
import { formatCount } from "../lib/format";
import { NotificationGroupBar } from "./NotificationGroup";
import { t } from "../i18n";

function initials(value: string): string {
  const words = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "?";
}

/**
 * Mount storyboard
 *   0 ms  shell and navigation are immediately usable
 *  60 ms  page heading settles
 * 120 ms  primary data surface settles
 * Reduced motion: all content is immediately visible.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const inSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const desktopNavigation = useMediaQuery("(min-width: 60rem)");
  const { user, logout } = useAuth();
  const { selectedProject, refreshFailures } = useProjects();
  const projectBase = selectedProject
    ? `/projects/${encodeURIComponent(selectedProject.id)}`
    : null;
  const navigationVisible = desktopNavigation || menuOpen;
  const projectAgentTotal = selectedProject
    ? selectedProject.healthy_agents + selectedProject.new_agents + selectedProject.warning_agents
      + selectedProject.critical_agents + selectedProject.stale_agents
    : 0;

  useEffect(() => {
    if (!menuOpen) return;
    sidebarRef.current?.querySelector<HTMLElement>("a")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t("Skip To Content")}
      </a>
      <header className="mobile-header">
        <NavLink className="wordmark" to={hasPermission(user, "view_projects") ? "/projects" : "/settings/password"}>
          <span className="brand-mark" aria-hidden="true"><Activity /></span>
          Server Monitor
        </NavLink>
        <button
          ref={menuButtonRef}
          className="icon-button"
          type="button"
          aria-label={menuOpen ? t("Close Navigation") : t("Open Navigation")}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((value) => !value)}
        >
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </header>

      <aside
        ref={sidebarRef}
        id="primary-navigation"
        className={`sidebar${menuOpen ? " sidebar--open" : ""}`}
        aria-label={t("Primary")}
        aria-hidden={!navigationVisible}
        inert={!navigationVisible}
      >
        <NavLink className="wordmark sidebar__wordmark" to={hasPermission(user, "view_projects") ? "/projects" : "/settings/password"} onClick={() => setMenuOpen(false)}>
          <span className="brand-mark" aria-hidden="true"><Activity /></span>
          <span>
            Server Monitor
            <small>{t("Internal Operations")}</small>
          </span>
        </NavLink>

        {selectedProject ? (
          <Link
            className="project-context-card"
            to="/projects"
            aria-label={t("Switch Project: {0}", selectedProject.name)}
            title={t("Switch Project")}
            onClick={() => setMenuOpen(false)}
          >
            <span className="project-context-card__label">{t("Current Project")}</span>
            <span className="project-context-card__selection">
              <span className="project-context-card__icon" aria-hidden="true">{initials(selectedProject.name)}</span>
              <span className="project-context-card__name">
                <strong>{selectedProject.name}</strong>
                <small>{formatCount(projectAgentTotal)} {projectAgentTotal === 1 ? t("Agent") : t("Agents")}</small>
              </span>
              <ArrowLeftRight aria-hidden="true" />
            </span>
          </Link>
        ) : null}

        {inSettings ? (
          <nav className="sidebar__nav" aria-label={t("Settings Navigation")}>
            <span className="sidebar__section-label">{t("Settings")}</span>
            {[
              ...(hasPermission(user, "edit_global_settings") ? [{ to: "/settings/telegram", label: t("Telegram"), icon: BellRing }] : []),
              ...(user?.role === "admin" ? [{ to: "/settings/admins", label: t("Teams"), icon: Users }] : []),
              { to: "/settings/password", label: t("Change Password"), icon: KeyRound }
            ].map(({ to, label, icon: Icon }) => <NavLink key={to} to={to}
              className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`}
              onClick={() => setMenuOpen(false)}><Icon aria-hidden="true" /><span>{label}</span></NavLink>)}
          </nav>
        ) : projectBase && selectedProject ? (
          <nav className="sidebar__nav sidebar__nav--project" aria-label={t("Project workspace for {0}", selectedProject.name)}>
          {projectBase ? <span className="sidebar__section-label">{t("Project Workspace")}</span> : null}
          {projectBase ? [
            { to: projectBase, label: t("Overview"), icon: Activity, end: true }
          ].map(({ to, label, icon: Icon, end }) => (
            <NavLink
              to={to}
              key={to}
              end={end}
              className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`}
              onClick={() => setMenuOpen(false)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          )) : null}
          </nav>
        ) : null}

        <NotificationGroupBar placement="sidebar" />

        <div className="sidebar__bottom">
          <SidebarClock />
          <div className="sidebar__utilities">
            <ThemeToggle />
            <LanguageToggle />
            {hasPermission(user, "edit_global_settings") || user?.role === "admin" ? (
              <NavLink
                to="/settings"
                className={({ isActive }) => `icon-button sidebar__settings${isActive ? " sidebar__settings--active" : ""}`}
                title={t("Settings")}
                aria-label={t("Settings")}
                onClick={() => setMenuOpen(false)}
              >
                <Settings aria-hidden="true" />
              </NavLink>
            ) : null}
          </div>
          <div className="sidebar__footer">
            <NavLink
              className={({ isActive }) => `sidebar__account${isActive ? " sidebar__account--active" : ""}`}
              to="/settings/password"
              title={t("Account Settings")}
              aria-label={t("Account Settings: {0}", user?.email ?? t("Account"))}
              onClick={() => setMenuOpen(false)}
            >
              <span className="sidebar__avatar" aria-hidden="true">{initials(user?.email?.split("@")[0] ?? "")}</span>
              <span className="sidebar__account-details">
                <strong>{user?.email}</strong>
                <span>{user?.role === "sub_admin" ? t("Sub-Admin") : t(user?.role ?? "")}</span>
              </span>
            </NavLink>
            <button className="icon-button" type="button" aria-label={t("Sign Out")} onClick={() => void logout()}>
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      {menuOpen ? (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label={t("Close Navigation")}
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <main
        className="main-content"
        id="main-content"
        tabIndex={-1}
        aria-hidden={menuOpen && !desktopNavigation}
        inert={menuOpen && !desktopNavigation}
      >
        {/* One failure can be a blip as a tab returns; repeated failures mean the page is showing old data. */}
        {refreshFailures >= 2 ? (
          <div className="form-banner form-banner--warning connection-notice" role="status">
            <WifiOff aria-hidden="true" />
            <p>{t("Can't reach the server. Showing the last received data until the connection returns.")}</p>
          </div>
        ) : null}
        {children}
        <footer className="system-footer">
          <span>Server Monitor 0.1.0</span>
        </footer>
      </main>
    </div>
  );
}
