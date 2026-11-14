import { useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button, TextInput } from "@togi/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

interface Props {
  mode: "login" | "register";
}

function isValidNgPhone(value: string): boolean {
  return /^(?:\+?234|0)?[789][01]\d{8}$/.test(value.replace(/[\s\-().]/g, ""));
}

function isValidPin(value: string): boolean {
  return /^\d{4}$/.test(value);
}

export default function Auth({ mode }: Props) {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/account";
  const isRegister = mode === "register";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [address, setAddress] = useState("");

  const phoneValid = useMemo(() => isValidNgPhone(phone), [phone]);

  if (!loading && user) return <Navigate to={from} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!phoneValid) {
      setError("Enter a valid Nigerian phone number.");
      return;
    }
    if (!isValidPin(pin)) {
      setError("Enter a 4-digit PIN.");
      return;
    }

    if (isRegister) {
      if (fullName.trim().length < 2) {
        setError("Please enter your full name.");
        return;
      }
      if (pin !== confirmPin) {
        setError("PIN confirmation does not match.");
        return;
      }
      if (address.trim().length < 5) {
        setError("Please enter your residential/delivery address.");
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
            phone: phone.trim(),
            pin,
            confirmPin,
            address: address.trim(),
          },
        });
      } else {
        await api("/auth/customer/login", {
          method: "POST",
          body: { phone: phone.trim(), pin },
        });
      }
      await refresh();
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Unable to sign in. Please try again.");
      } else {
        setError("Unable to sign in. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md anim-enter">
      <div className="t-card t-card--pad shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">
          {isRegister ? "Create your account" : "Sign in"}
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
          {isRegister
            ? "Register with your phone number and a 4-digit PIN to manage your requests."
            : "Sign in with your phone number and 4-digit PIN."}
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
            label="Phone number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0803 123 4567"
            hint="Nigerian mobile number"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <TextInput
            label="4-digit PIN"
            type={showPin ? "text" : "password"}
            inputMode="numeric"
            autoComplete={isRegister ? "new-password" : "current-password"}
            maxLength={4}
            placeholder="••••"
            required
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />

          {isRegister ? (
            <TextInput
              label="Confirm 4-digit PIN"
              type={showPin ? "text" : "password"}
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={4}
              placeholder="••••"
              required
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          ) : null}

          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
            <input type="checkbox" checked={showPin} onChange={(e) => setShowPin(e.target.checked)} />
            Show PIN
          </label>

          {isRegister ? (
            <TextInput
              label="Residential/Delivery address"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Enter your residential or delivery address"
            />
          ) : null}

          {error ? (
            <p role="alert" className="text-sm" style={{ color: "var(--error)" }}>
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" block loading={busy}>
            {isRegister ? "Create account" : "Sign in"}
          </Button>
        </form>

        {!isRegister ? (
          <p className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>
            Need help accessing your account? Please contact support for assistance.
          </p>
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
