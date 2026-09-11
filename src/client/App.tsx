import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Navigate, Route, Routes, useParams, useLocation } from "react-router-dom";
import { hasPermission } from "../shared/permissions";
import { useAuth } from "./auth/AuthProvider";
import { AppShell } from "./components/AppShell";
import { ErrorState, PageSkeleton } from "./components/Feedback";
import { CreateProjectPage } from "./pages/CreateProjectPage";
import { InstallAgentPage } from "./pages/InstallAgentPage";
import { LoginPage } from "./pages/LoginPage";
import { PlatformSettingsPage } from "./pages/PlatformSettingsPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectProvider } from "./projects/ProjectProvider";
import { AccountPage } from "./pages/AccountPage";
import { AdminManagementPage } from "./pages/AdminManagementPage";
import { ScrollToTop } from "./components/ScrollToTop";

const AgentDetailPage = lazy(async () => {
  const module = await import("./pages/AgentDetailPage");
  return { default: module.AgentDetailPage };
});

export function ProjectOverviewRedirect() {
  const { projectId } = useParams();
  return (
    <Navigate
      to={projectId ? `/projects/${encodeURIComponent(projectId)}` : "/projects"}
      replace
    />
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Backoffice render failed", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="standalone-feedback">
          <ErrorState
            title="The Backoffice Could Not Render"
            message="Reload the page. If the problem continues, inspect the central service logs."
            onRetry={() => window.location.reload()}
          />
        </main>
      );
    }
    return this.props.children;
  }
}

function ProtectedApplication() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === "loading") return <main className="standalone-feedback"><PageSkeleton rows={5} /></main>;
  if (status === "anonymous") return <Navigate to="/login" replace />;
  if (!hasPermission(user, "view_projects") && !location.pathname.startsWith("/settings") && location.pathname !== "/account") return <Navigate to="/settings/password" replace />;

  return (
    <ProjectProvider>
      <AppShell>
        <Routes>
          <Route path="/account" element={<Navigate to="/settings/password" replace />} />
          <Route path="/settings/password" element={<AccountPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/settings" element={<Navigate to={hasPermission(user, "edit_global_settings") ? "/settings/telegram" : "/settings/password"} replace />} />
          <Route path="/settings/telegram" element={hasPermission(user, "edit_global_settings") ? <PlatformSettingsPage /> : <Navigate to="/settings/password" replace />} />
          <Route path="/settings/admins" element={user?.role === "admin" ? <AdminManagementPage /> : <Navigate to="/settings/password" replace />} />
          <Route path="/projects/new" element={hasPermission(user, "edit_project_settings") ? <CreateProjectPage /> : <Navigate to="/projects" replace />} />
          <Route path="/projects/:projectId" element={<InstallAgentPage />} />
          <Route path="/projects/:projectId/agents" element={<ProjectOverviewRedirect />} />
          <Route path="/projects/:projectId/incidents" element={<ProjectOverviewRedirect />} />
          <Route path="/projects/:projectId/settings" element={<ProjectOverviewRedirect />} />
          <Route
            path="/projects/:projectId/agents/:agentId"
            element={
              <Suspense fallback={<PageSkeleton rows={8} />}>
                <AgentDetailPage />
              </Suspense>
            }
          />
          <Route path="/overview" element={<InstallAgentPage />} />
          <Route path="/agents" element={<InstallAgentPage />} />
          <Route path="/install" element={<InstallAgentPage />} />
          <Route path="/incidents" element={<InstallAgentPage />} />
          <Route
            path="/agents/:agentId"
            element={
              <Suspense fallback={<PageSkeleton rows={8} />}>
                <AgentDetailPage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </AppShell>
    </ProjectProvider>
  );
}

export function App() {
  return (
    <AppErrorBoundary>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<ProtectedApplication />} />
      </Routes>
    </AppErrorBoundary>
  );
}
