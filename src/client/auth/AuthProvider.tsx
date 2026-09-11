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
import { apiFetch, setCsrfToken } from "../api";

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

  const restore = useCallback(async () => {
    try {
      const session = await apiFetch<SessionResponse>("/api/v1/auth/session");
      setCsrfToken(session.csrf_token);
      setUser(session.user);
      setStatus("authenticated");
    } catch {
      setCsrfToken(null);
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const refresh = () => { if (document.visibilityState !== "hidden") void restore(); };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [status, restore]);

  const login = useCallback(async (email: string, password: string, rememberSession: boolean) => {
    const session = await apiFetch<SessionResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, remember_session: rememberSession })
    });
    setCsrfToken(session.csrf_token);
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    await apiFetch<void>("/api/v1/auth/logout", { method: "POST", body: "{}" });
    setCsrfToken(null);
    setUser(null);
    setStatus("anonymous");
  }, []);

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
