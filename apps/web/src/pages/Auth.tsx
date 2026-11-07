import { useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError, getCsrfToken } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, TextInput } from "@togi/ui";

/**
 * Sign in / register — customer OTP flow (v1.2 §12):
 * 1. phone (+ name for register) → POST /auth/otp/request (sets CSRF cookie)
 * 2. 6-digit code → POST /auth/otp/verify (CSRF in header AND body)
 *
 * Server responses are enumeration-resistant: the message never reveals
 * whether the number has an account; throttles surface as friendly errors
 * with a Retry-After hint.
 */

type Step = "phone" | "code";

interface Props {
  mode: "login" | "register";
}

export default function Auth({ mode }: Props) {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/account";

  const [step, setStep] = useState<Step>("phone");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const isRegister = mode === "register";

  const phoneValid = useMemo(() => {
    const digits = phone.replace(/[\s\-().]/g, "");
    return /^(?:\+?234|0)?[789][01]\d{8}$/.test(digits);
  }, [phone]);

  if (!loading && user) return <Navigate to={from} replace />;

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    if (!phoneValid) {
      setError("Enter a valid Nigerian number, e.g. 0803 123 4567.");
      return;
    }
    if (isRegister && name.trim().length < 2) {
      setError("Please enter your name.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ ok: true; csrfToken: string; message: string }>(
        "/auth/otp/request",
        { method: "POST", body: { phone: phone.trim() } },
      );
      setNotice(res.message);
      setStep("code");
      // Focus the code input once rendered
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      const csrf = getCsrfToken();
      await api("/auth/otp/verify", {
        method: "POST",
        body: {
          phone: phone.trim(),
          code,
          purpose: isRegister ? "register" : "login",
          ...(csrf ? { csrfToken: csrf } : {}),
          ...(isRegister ? { fullName: name.trim() } : {}),
        },
      });
      await refresh();
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed.");
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="t-card t-card--pad">
        <h1 className="text-xl font-semibold tracking-tight">
          {isRegister ? "Create your account" : "Sign in"}
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
          {isRegister
            ? "One number, one account — your requests, cylinders and claims together."
            : "We'll text you a code. No passwords to remember."}
        </p>

        {step === "phone" ? (
          <form onSubmit={requestCode} className="mt-6 space-y-5" noValidate>
            {isRegister ? (
              <TextInput
                label="Full name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            ) : null}
            <TextInput
              label="Phone number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0803 123 4567"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {error ? (
              <p role="alert" className="text-sm" style={{ color: "var(--error)" }}>
                {error}
              </p>
            ) : null}
            <Button type="submit" size="lg" block loading={busy}>
              Send me a code
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-6 space-y-5" noValidate>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {notice ?? "Enter the code we sent to"}{" "}
              <strong style={{ color: "var(--text)" }}>{phone}</strong>
            </p>

            <TextInput
              ref={codeRef}
              label="Verification code"
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
              Verify
            </Button>

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className="underline"
                style={{ color: "var(--text-muted)" }}
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setError(null);
                }}
              >
                Change number
              </button>
              <button
                type="button"
                className="underline"
                style={{ color: "var(--text-muted)" }}
                disabled={busy}
                onClick={() => void requestCode()}
              >
                Resend code
              </button>
            </div>
          </form>
        )}
      </div>

      <p className="mt-5 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        {isRegister ? (
          <>
            Already registered?{" "}
            <Link to="/login" className="font-medium underline" style={{ color: "var(--text)" }}>
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link to="/register" className="font-medium underline" style={{ color: "var(--text)" }}>
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
