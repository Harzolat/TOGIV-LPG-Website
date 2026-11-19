import { useCallback, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button, TextInput } from "@togi/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function Wordmark() {
  return (
    <div className="flex justify-center">
      <Link
        to="/login"
        aria-label="Throne of Grace Integrated Ventures — operations sign in"
        className="inline-flex items-center gap-2 sm:gap-2.5"
      >
        <img
          src="/brand/togiv-white-logo.png"
          alt=""
          aria-hidden="true"
          className="block h-auto max-h-10 w-auto max-w-[64px] shrink-0 sm:max-h-12 sm:max-w-[76px]"
          style={{ objectFit: "contain" }}
          decoding="async"
        />
        <span className="inline-flex min-w-0 flex-col text-left leading-none">
          <span
            className="truncate text-[0.9375rem] font-semibold tracking-[0.14em]"
            style={{ color: "var(--text)" }}
          >
            THRONE OF GRACE
          </span>
          <span
            className="mt-1 truncate text-[0.6875rem] tracking-[0.22em] uppercase"
            style={{ color: "var(--primary)" }}
          >
            INTEGRATED VENTURES
          </span>
        </span>
      </Link>
    </div>
  );
}

export default function Login() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/queue";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Self-service password recovery (email link)
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);

  const finish = useCallback(async () => {
    await refresh();
    navigate(from, { replace: true });
  }, [from, navigate, refresh]);

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const value = email.trim().toLowerCase();
    if (!isValidEmail(value)) {
      setError("Enter your work email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    setBusy(true);
    try {
      await api("/auth/staff/login", {
        method: "POST",
        body: { email: value, password },
      });
      await finish();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  function openRecovery() {
    setRecoveryOpen((v) => !v);
    setForgotError(null);
    setForgotMessage(null);
  }

  async function submitForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setForgotError(null);
    setForgotMessage(null);

    const target = email.trim().toLowerCase();
    if (!isValidEmail(target)) {
      setForgotError("Enter your work email above first.");
      return;
    }

    setForgotBusy(true);
    try {
      const res = await api<{ ok: boolean; message?: string }>(
        "/auth/staff/forgot-password",
        { method: "POST", body: { email: target } },
      );
      setForgotMessage(
        res.message ||
          "If an account exists for this email, a password reset link has been sent.",
      );
    } catch (err) {
      setForgotError(
        err instanceof ApiError
          ? err.message || "Could not request password reset."
          : "Could not request password reset.",
      );
    } finally {
      setForgotBusy(false);
    }
  }

  if (!loading && user) return <Navigate to={from} replace />;

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--background)" }}>
      <div className="t-rule" aria-hidden="true" style={{ height: 3 }} />
      <main className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-md">
          <Wordmark />

          <div className="t-card t-card--pad mt-8">
            <h1 className="text-xl font-semibold tracking-tight">Staff sign in</h1>
            <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
              Operations console — sign in with your email and password.
            </p>

            <form onSubmit={submitLogin} className="mt-6 space-y-5" noValidate>
              <TextInput
                label="Work email"
                type="email"
                inputMode="email"
                autoComplete="username"
                placeholder="you@togiv.example"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <TextInput
                label="Password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={error ?? undefined}
              />
              <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                />
                Show password
              </label>
              <Button type="submit" size="lg" block loading={busy}>
                Sign in
              </Button>
            </form>

            <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <button
                type="button"
                className="text-sm font-medium underline"
                style={{ color: "var(--text)" }}
                onClick={() => void openRecovery()}
                aria-expanded={recoveryOpen}
              >
                Forgot password?
              </button>

              {recoveryOpen ? (
                <form onSubmit={submitForgotPassword} className="mt-3 space-y-3" noValidate>
                  {forgotError ? (
                    <p role="alert" className="text-sm" style={{ color: "var(--error)" }}>
                      {forgotError}
                    </p>
                  ) : null}
                  {forgotMessage ? (
                    <p role="status" className="text-sm" style={{ color: "var(--success, #16a34a)" }}>
                      {forgotMessage}
                    </p>
                  ) : null}
                  <Button type="submit" variant="secondary" block loading={forgotBusy}>
                    Send reset link
                  </Button>
                </form>
              ) : null}
            </div>
          </div>

          <p className="mt-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            Staff access only. For customer support, please use the main website.
          </p>
        </div>
      </main>
    </div>
  );
}
