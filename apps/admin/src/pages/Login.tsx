import { useCallback, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button, TextInput } from "@togi/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

/**
 * Staff sign-in — v1.2 §12: password + TOTP second factor.
 *
 * The API is enumeration-resistant and uniformly timed; the UI mirrors its
 * three outcomes rather than guessing them:
 *   password ok, first login → { step: "enroll", enrollmentToken }
 *   password ok, enrolled    → { step: "totp" }
 *   both factors ok          → { ok: true } (session cookies set)
 *
 * Enrollment is deliberately a separate screen: the secret is generated on
 * the server and only persisted once a valid code proves the authenticator
 * holds it.
 */

type Step = "password" | "totp" | "enroll";

type LoginResponse =
  | { step: "enroll"; enrollmentToken: string }
  | { step: "totp" }
  | { ok: true; csrfToken: string; userId: string };

function Wordmark() {
  return (
    <div className="text-center leading-none">
      <p
        className="text-[0.9375rem] font-semibold tracking-[0.14em]"
        style={{ color: "var(--text)" }}
      >
        TOGIV OPERATIONS
      </p>
      <p
        className="mt-1 text-[0.6875rem] tracking-[0.22em] uppercase"
        style={{ color: "var(--primary)" }}
      >
        Integrated Ventures
      </p>
    </div>
  );
}

export default function Login() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/queue";

  const [step, setStep] = useState<Step>("password");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollmentToken, setEnrollmentToken] = useState("");
  const [secret, setSecret] = useState("");
  const [otpauthUri, setOtpauthUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const finish = useCallback(async () => {
    await refresh();
    navigate(from, { replace: true });
  }, [from, navigate, refresh]);

  /** Step 1 — identifier + password. */
  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (identifier.trim().length < 3) {
      setError("Enter your work email or phone number.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<LoginResponse>("/auth/staff/login", {
        method: "POST",
        body: { identifier: identifier.trim(), password },
      });
      if ("ok" in res) {
        await finish();
        return;
      }
      if (res.step === "totp") {
        setStep("totp");
        setTimeout(() => codeRef.current?.focus(), 50);
        return;
      }
      // First login: password proven, set up the second factor.
      const setup = await api<{ secret: string; otpauthUri: string }>(
        "/auth/staff/enroll/setup",
        { method: "POST", body: { enrollmentToken: res.enrollmentToken } },
      );
      setEnrollmentToken(res.enrollmentToken);
      setSecret(setup.secret);
      setOtpauthUri(setup.otpauthUri);
      setStep("enroll");
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  /** Step 2 — second factor for an already-enrolled account. */
  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<LoginResponse>("/auth/staff/login", {
        method: "POST",
        body: { identifier: identifier.trim(), password, totpCode: code },
      });
      if ("ok" in res) {
        await finish();
        return;
      }
      // Password no longer accepted (e.g. changed mid-flow) — restart.
      setStep("password");
      setCode("");
      setError("Please sign in again.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not verify the code.");
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  /** Step 3 — prove the authenticator holds the new secret, then sign in. */
  async function submitEnrollment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    try {
      await api("/auth/staff/enroll/verify", {
        method: "POST",
        body: { enrollmentToken, secret, code },
      });
      await finish();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not finish setup.");
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed — select the key and copy it manually.");
    }
  }

  function startOver() {
    setStep("password");
    setCode("");
    setSecret("");
    setOtpauthUri("");
    setEnrollmentToken("");
    setError(null);
  }

  if (!loading && user) return <Navigate to={from} replace />;

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--background)" }}>
      <div className="t-rule" aria-hidden="true" style={{ height: 3 }} />
      <main className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-md">
          <Wordmark />

          <div className="t-card t-card--pad mt-8">
            {step === "password" ? (
              <>
                <h1 className="text-xl font-semibold tracking-tight">Staff sign in</h1>
                <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
                  Operations console — password and authenticator code required.
                </p>

                <form onSubmit={submitPassword} className="mt-6 space-y-5" noValidate>
                  <TextInput
                    label="Work email or phone"
                    autoComplete="username"
                    placeholder="you@togiv.example"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                  />
                  <TextInput
                    label="Password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    error={error ?? undefined}
                  />
                  <Button type="submit" size="lg" block loading={busy}>
                    Continue
                  </Button>
                </form>
              </>
            ) : step === "totp" ? (
              <>
                <h1 className="text-xl font-semibold tracking-tight">Two-factor code</h1>
                <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
                  Open your authenticator app and enter the current 6-digit code for{" "}
                  <strong style={{ color: "var(--text)" }}>{identifier}</strong>.
                </p>

                <form onSubmit={submitTotp} className="mt-6 space-y-5" noValidate>
                  <TextInput
                    ref={codeRef}
                    className="t-field--code"
                    label="Authenticator code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="••••••"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    error={error ?? undefined}
                  />
                  <Button type="submit" size="lg" block loading={busy} disabled={code.length !== 6}>
                    Sign in
                  </Button>
                  <button
                    type="button"
                    onClick={startOver}
                    className="block w-full text-center text-sm underline"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Use a different account
                  </button>
                </form>
              </>
            ) : (
              <>
                <h1 className="text-xl font-semibold tracking-tight">Set up two-factor</h1>
                <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
                  First sign-in. Add this account to an authenticator app (Google
                  Authenticator, Authy, 1Password…) before continuing.
                </p>

                <div
                  className="mt-5 rounded-xl border p-4"
                  style={{ borderColor: "var(--border)", background: "var(--field)" }}
                >
                  <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                    Setup key
                  </p>
                  <code
                    className="mt-1.5 block break-all font-mono text-sm font-semibold"
                    style={{ color: "var(--primary)" }}
                  >
                    {secret}
                  </code>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Time-based (TOTP), 6 digits, 30 seconds.
                    </span>
                    <Button type="button" variant="secondary" size="sm" onClick={() => void copySecret()}>
                      {copied ? "Copied" : "Copy key"}
                    </Button>
                  </div>
                  <details className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                    <summary className="cursor-pointer">Advanced: add by URI</summary>
                    <code className="mt-2 block break-all font-mono">{otpauthUri}</code>
                  </details>
                </div>

                <form onSubmit={submitEnrollment} className="mt-6 space-y-5" noValidate>
                  <TextInput
                    ref={codeRef}
                    className="t-field--code"
                    label="Code from the app"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="••••••"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    error={error ?? undefined}
                  />
                  <Button type="submit" size="lg" block loading={busy} disabled={code.length !== 6}>
                    Finish setup &amp; sign in
                  </Button>
                  <button
                    type="button"
                    onClick={startOver}
                    className="block w-full text-center text-sm underline"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Cancel
                  </button>
                </form>
              </>
            )}
          </div>

          <p className="mt-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            Staff access only. Customers sign in with a one-time code on the main site.
          </p>
        </div>
      </main>
    </div>
  );
}
