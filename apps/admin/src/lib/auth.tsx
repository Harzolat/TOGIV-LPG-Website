import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError } from "./api";

/** Session context for the admin console — bootstraps from
 *  `GET /auth/staff/me` on the admin origin (the customer `/auth/me` is a
 *  different audience and would be rejected by the audience guard).
 *  States: loading | authenticated | anonymous. */
export interface SessionUser {
  id: string;
  phone: string;
  email: string | null;
  fullName: string | null;
  department: string | null;
  roles: string[];
  totpEnrolled: boolean;
}

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api<SessionUser>("/auth/staff/me");
      setUser(me);
    } catch {
      // 401/403 (or an unreachable API) all mean "not signed in" here.
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch (e) {
      // A 403 with a stale session still means "no session" from our side.
      if (!(e instanceof ApiError)) throw e;
    } finally {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, loading, refresh, logout }),
    [user, loading, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
