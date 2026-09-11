import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode
} from "react";
import { useLocation } from "react-router-dom";
import type { ProjectSummary } from "../../shared/contracts";
import { hasPermission } from "../../shared/permissions";
import { useAuth } from "../auth/AuthProvider";
import { apiFetch } from "../api";
import { FAST_REFRESH_INTERVAL_MS, useApiResource } from "../hooks/useApiResource";

interface ProjectContextValue {
  projects: ProjectSummary[];
  selectedProject: ProjectSummary | null;
  status: "loading" | "success" | "error";
  error: Error | null;
  reloadProjects: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function projectIdFromLocation(pathname: string, search: string): string | null {
  if (pathname === "/projects/new") return null;
  const routeMatch = pathname.match(/^\/projects\/([^/]+)(?:\/|$)/);
  if (routeMatch?.[1]) return routeMatch[1];
  const legacyProjectRoute =
    pathname === "/overview" ||
    pathname === "/agents" ||
    pathname === "/install" ||
    pathname === "/incidents" ||
    pathname.startsWith("/agents/");
  return legacyProjectRoute ? new URLSearchParams(search).get("project") : null;
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const canView = hasPermission(user, "view_projects");
  const location = useLocation();
  const loadProjects = useCallback(() => canView ? apiFetch<ProjectSummary[]>("/api/v1/projects") : Promise.resolve([]), [canView]);
  const resource = useApiResource<ProjectSummary[]>("projects", loadProjects, {
    refreshIntervalMs: FAST_REFRESH_INTERVAL_MS
  });
  const selectedId = projectIdFromLocation(location.pathname, location.search);
  const projects = canView ? resource.data ?? [] : [];
  const selectedProject = selectedId
    ? projects.find((project) => project.id === selectedId) ?? null
    : null;

  const value = useMemo(
    () => ({
      projects,
      selectedProject,
      status: resource.status,
      error: resource.error,
      reloadProjects: resource.reload
    }),
    [projects, selectedProject, resource.status, resource.error, resource.reload]
  );
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjects(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProjects must be used within ProjectProvider.");
  return value;
}
