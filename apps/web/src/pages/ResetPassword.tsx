import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, TextInput } from "@togi/ui";
import { api, ApiError } from "../lib/api";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => (searchParams.get("token") ?? "").trim(), [searchParams]);

  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token) {
      setError("This password reset link is invalid or missing. Please request a new reset link.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      await api("/auth/customer/reset-password", {
        method: "POST",
        body: { token, newPassword },
      });
      setSuccess("Password reset successful. You can now sign in with your new password.");
      setTimeout(() => navigate("/login", { replace: true }), 1200);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Could not reset password. The link may be invalid or expired."
          : "Could not reset password. The link may be invalid or expired.",
      );
    } finally {
      setBusy(false);
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
        <h1 className="text-xl font-semibold tracking-tight">Reset password</h1>

        {!token ? (
          <div className="mt-6 space-y-4">
            <p role="alert" className="text-sm" style={{ color: "var(--error)" }}>
              This reset link is invalid or missing.
            </p>
            <Link to="/login" className="t-btn t-btn--primary t-btn--lg inline-flex w-full justify-center">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <TextInput
              label="New password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
              />
              Show password
            </label>

            {error ? (
              <p role="alert" className="text-sm" style={{ color: "var(--error)" }}>
                {error}
              </p>
            ) : null}
            {success ? (
              <p role="status" className="text-sm" style={{ color: "var(--success, #16a34a)" }}>
                {success}
              </p>
            ) : null}

            <Button type="submit" size="lg" block loading={busy}>
              Reset password
            </Button>
          </form>
        )}
      </div>

      {token ? (
        <p className="mt-5 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          <Link to="/login" className="font-medium underline" style={{ color: "var(--text)" }}>
            Back to sign in
          </Link>
        </p>
      ) : null}
    </div>
  );
}
