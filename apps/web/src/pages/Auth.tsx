import { useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button, TextInput } from "@togi/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

interface Props {
  mode: "login" | "register";
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function Auth({ mode }: Props) {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/account";
  const isRegister = mode === "register";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateAccountPrompt, setShowCreateAccountPrompt] = useState(false);

  const prefillEmail = (location.state as { email?: string } | null)?.email ?? "";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Self-service password recovery (email link)
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);

  const emailValid = useMemo(() => isValidEmail(email), [email]);

  if (!loading && user) return <Navigate to={from} replace />;

  function openRecovery() {
    setRecoveryOpen((v) => !v);
    setForgotError(null);
    setForgotMessage(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setShowCreateAccountPrompt(false);

    if (!emailValid) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (isRegister) {
      if (fullName.trim().length < 2) {
        setError("Please enter your full name.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Password confirmation does not match.");
        return;
      }
    }

    setBusy(true);
    try {
      if (isRegister) {
        await api("/auth/customer/register", {
          method: "POST",
          body: {
            fullName: fullName.trim(),
            email: email.trim().toLowerCase(),
            password,
            confirmPassword,
            phone: phone.trim() || undefined,
            address: address.trim() || undefined,
          },
        });
      } else {
        await api("/auth/customer/login", {
          method: "POST",
          body: { email: email.trim().toLowerCase(), password },
        });
      }
      await refresh();
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const msg = err.message || "Unable to sign in. Please try again.";
        setError(msg);
        if (
          !isRegister &&
          /no account found for this email/i.test(msg)
        ) {
          setShowCreateAccountPrompt(true);
        }
      } else {
        setError("Unable to sign in. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setForgotError(null);
    setForgotMessage(null);

    const target = email.trim().toLowerCase();
    if (!isValidEmail(target)) {
      setForgotError("Enter your email address above first.");
      return;
    }

    setForgotBusy(true);
    try {
      const res = await api<{ ok: boolean; message?: string }>(
        "/auth/customer/forgot-password",
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

  return (
    <div className="mx-auto max-w-md anim-enter">
      <div className="mb-6 flex justify-center">
        <Link to="/" aria-label="TOGIV — home" className="inline-flex">
          <span
            className="text-xl font-semibold tracking-[0.14em] sm:text-2xl"
            style={{ color: "var(--text)" }}
          >
            TOGIV
          </span>
        </Link>
      </div>
      <div className="t-card t-card--pad shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">
          {isRegister ? "Create your account" : "Sign in"}
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
          {isRegister
            ? "Register with your email and password to manage your requests."
            : "Sign in with your email and password."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4 stagger-children" noValidate>
          {isRegister ? (
            <TextInput
              label="Full name"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          ) : null}

          <TextInput
            label="Email address"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <TextInput
            label="Password"
            type={showPassword ? "text" : "password"}
            autoComplete={isRegister ? "new-password" : "current-password"}
            placeholder={isRegister ? "At least 8 characters" : "Enter your password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {isRegister ? (
            <TextInput
              label="Confirm password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          ) : null}

          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
            />
            Show password
          </label>

          {isRegister ? (
            <>
              <TextInput
                label="Phone number (optional)"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="0803 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <TextInput
                label="Residential/Delivery address (optional)"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Enter your residential or delivery address"
              />
            </>
          ) : null}

          {error ? (
            <div role="alert" className="text-sm" style={{ color: "var(--error)" }}>
              <p>{error}</p>
              {showCreateAccountPrompt ? (
                <p className="mt-2" style={{ color: "var(--text-muted)" }}>
                  <Link
                    to="/register"
                    state={{ from, email: email.trim().toLowerCase() }}
                    className="font-medium underline"
                    style={{ color: "var(--text)" }}
                  >
                    Create an account
                  </Link>{" "}
                  with this email, then sign in.
                </p>
              ) : null}
            </div>
          ) : null}

          <Button type="submit" size="lg" block loading={busy}>
            {isRegister ? "Create account" : "Sign in"}
          </Button>
        </form>

        {!isRegister ? (
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
        ) : null}
      </div>

      <p className="mt-5 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        {isRegister ? (
          <>
            Already have an account?{" "}
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
