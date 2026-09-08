import {
  Activity,
  BellRing,
  KeyRound,
  Users,
  ArrowLeftRight,
  LogOut,
  Menu,
  ScrollText,
  Server,
  Settings,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useProjects } from "../projects/ProjectProvider";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { ThemeToggle } from "./ThemeToggle";

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
  const { selectedProject } = useProjects();
  const projectBase = selectedProject
    ? `/projects/${encodeURIComponent(selectedProject.id)}`
    : null;
  const navigationVisible = desktopNavigation || menuOpen;

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
        Skip To Content
      </a>
      <header className="mobile-header">
        <NavLink className="wordmark" to="/projects">
          <ScrollText aria-hidden="true" />
          Server Check
        </NavLink>
        <button
          ref={menuButtonRef}
          className="icon-button"
          type="button"
          aria-label={menuOpen ? "Close Navigation" : "Open Navigation"}
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
        aria-label="Primary"
        aria-hidden={!navigationVisible}
        inert={!navigationVisible}
      >
        <NavLink className="wordmark sidebar__wordmark" to="/projects" onClick={() => setMenuOpen(false)}>
          <ScrollText aria-hidden="true" />
          <span>
            Server Check
            <small>Internal Operations</small>
          </span>
        </NavLink>

        {selectedProject ? (
          <Link
            className="project-context-card"
            to="/projects"
            aria-label={`Switch Project: ${selectedProject.name}`}
            title="Switch Project"
            onClick={() => setMenuOpen(false)}
          >
            <span className="project-context-card__label">Current Project</span>
            <span className="project-context-card__selection">
              <span className="project-context-card__icon"><Server aria-hidden="true" /></span>
              <strong>{selectedProject.name}</strong>
              <ArrowLeftRight aria-hidden="true" />
            </span>
          </Link>
        ) : null}

        {inSettings ? (
          <nav className="sidebar__nav" aria-label="Settings Navigation">
            <span className="sidebar__section-label">Settings</span>
            {[
              ...(user?.role === "admin" ? [
                { to: "/settings/telegram", label: "Telegram", icon: BellRing },
                { to: "/settings/admins", label: "Teams", icon: Users }
              ] : []),
              { to: "/settings/password", label: "Change Password", icon: KeyRound }
            ].map(({ to, label, icon: Icon }) => <NavLink key={to} to={to}
              className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`}
              onClick={() => setMenuOpen(false)}><Icon aria-hidden="true" /><span>{label}</span></NavLink>)}
          </nav>
        ) : projectBase && selectedProject ? (
          <nav className="sidebar__nav sidebar__nav--project" aria-label={`Project workspace for ${selectedProject.name}`}>
          {projectBase ? <span className="sidebar__section-label">Project Workspace</span> : null}
          {projectBase ? [
            { to: projectBase, label: "Overview", icon: Activity, end: true }
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

        <div className="sidebar__bottom">
          <div className="sidebar__utilities">
            <ThemeToggle />
            {user?.role === "admin" ? (
              <NavLink
                to="/settings"
                className={({ isActive }) => `icon-button sidebar__settings${isActive ? " sidebar__settings--active" : ""}`}
                title="Settings"
                aria-label="Settings"
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
              title="Account Settings"
              aria-label={`Account Settings: ${user?.email ?? "Account"}`}
              onClick={() => setMenuOpen(false)}
            >
              <UserRound aria-hidden="true" />
              <span className="sidebar__account-details">
                <strong>{user?.email}</strong>
                <span>{user?.role}</span>
              </span>
            </NavLink>
            <button className="icon-button" type="button" aria-label="Sign Out" onClick={() => void logout()}>
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      {menuOpen ? (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Close Navigation"
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
        {children}
        <footer className="system-footer">
          <span>Server Check 0.1.0</span>
        </footer>
      </main>
    </div>
  );
}
