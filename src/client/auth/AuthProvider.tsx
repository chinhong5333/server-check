import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { AuthenticatedUser, SessionResponse } from "../../shared/contracts";
import { ApiError, apiFetch, setCsrfToken } from "../api";

interface AuthContextValue {
  user: AuthenticatedUser | null;
  status: "loading" | "authenticated" | "anonymous";
  login: (email: string, password: string, rememberSession: boolean) => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");

  const applySession = useCallback((session: SessionResponse) => {
    setCsrfToken(session.csrf_token);
    setUser(session.user);
    setStatus("authenticated");
  }, []);
  const clearSession = useCallback(() => {
    setCsrfToken(null);
    setUser(null);
    setStatus("anonymous");
  }, []);

  const restore = useCallback(async () => {
    try {
      applySession(await apiFetch<SessionResponse>("/api/v1/auth/session"));
    } catch {
      clearSession();
    }
  }, [applySession, clearSession]);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      // Only the server rejecting the session ends it; a network blip or restart waits for the next check.
      apiFetch<SessionResponse>("/api/v1/auth/session").then(applySession, (cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 401) clearSession();
      });
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [status, applySession, clearSession]);

  const login = useCallback(async (email: string, password: string, rememberSession: boolean) => {
    const session = await apiFetch<SessionResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, remember_session: rememberSession })
    });
    applySession(session);
  }, [applySession]);

  const logout = useCallback(async () => {
    await apiFetch<void>("/api/v1/auth/logout", { method: "POST", body: "{}" });
    clearSession();
  }, [clearSession]);

  const value = useMemo(
    () => ({ user, status, login, logout, restore }),
    [user, status, login, logout, restore]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
