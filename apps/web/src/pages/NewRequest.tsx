import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { SubmitResponse } from "../lib/types";
import { useAuth } from "../lib/auth";
import { Button, Select, TextArea, TextInput, useToast } from "@togi/ui";

/**
 * Refill request — 3-step, mobile-friendly flow.
 * Service model: on-site refill (team comes to location and fills cylinder)
 * or station refill (customer brings cylinder). No cylinder is dispatched.
 * Payment is confirmed before completion.
 */

const CAPACITIES = [
  { value: "0.5", label: "0.5 kg" },
  { value: "1", label: "1 kg" },
  { value: "2", label: "2 kg" },
  { value: "3", label: "3 kg" },
  { value: "6", label: "6 kg" },
  { value: "12.5", label: "12.5 kg" },
  { value: "25", label: "25 kg" },
  { value: "50", label: "50 kg" },
  { value: "custom", label: "Custom capacity" },
];

interface AddressForm {
  line1: string;
}

const EMPTY_ADDRESS: AddressForm = {
  line1: "",
};

type Step = 1 | 2 | 3;

function isValidNgPhone(value: string): boolean {
  const digits = value.replace(/[\s\-().]/g, "");
  return /^(?:\+?234|0)?[789][01]\d{8}$/.test(digits);
}

export default function NewRequest() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>(1);
  const [capacity, setCapacity] = useState("12.5");
  const [customCapacity, setCustomCapacity] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [option, setOption] = useState<"home" | "station">("home");

  const [phone, setPhone] = useState("");
  const [phonePrefilled, setPhonePrefilled] = useState(false);
  const [address, setAddress] = useState<AddressForm>(EMPTY_ADDRESS);
  const [addressPrefilled, setAddressPrefilled] = useState(false);
  const [notes, setNotes] = useState("");

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SubmitResponse | null>(null);

  useEffect(() => {
    if (user?.phone && !phonePrefilled && !phone) {
      setPhone(user.phone);
      setPhonePrefilled(true);
    }
  }, [user, phonePrefilled, phone]);

  useEffect(() => {
    const saved = user?.profile?.defaultAddress;
    if (!saved || addressPrefilled) return;
    // Prefill saved service location for on-site refills (customer can edit for this request).
    setAddress((prev) => {
      const isEmpty = !prev.line1;
      if (!isEmpty) return prev;
      return {
        line1: saved.line1 ?? "",
      };
    });
    setAddressPrefilled(true);
  }, [user, addressPrefilled]);

  const markTouched = (key: string) =>
    setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }));

  const phoneError = useMemo(() => {
    if (!touched.phone && !submitAttempted) return undefined;
    if (!phone.trim()) return "Enter your phone number.";
    if (!isValidNgPhone(phone)) return "Enter a valid Nigerian number, e.g. 0803 123 4567.";
    return undefined;
  }, [phone, touched.phone, submitAttempted]);

  const capacityKg = capacity === "custom" ? Number(customCapacity) : Number(capacity);
  const capacityError = useMemo(() => {
    if (!touched.capacity && !submitAttempted) return undefined;
    if (capacity === "custom") {
      if (!customCapacity.trim()) return "Enter a custom cylinder capacity.";
      if (!Number.isFinite(capacityKg) || capacityKg <= 0 || capacityKg > 100) {
        return "Enter a valid capacity (greater than 0 and up to 100 kg).";
      }
      return undefined;
    }
    if (!Number.isFinite(capacityKg) || capacityKg <= 0) return "Select a cylinder capacity.";
    return undefined;
  }, [capacity, customCapacity, capacityKg, touched.capacity, submitAttempted]);

  const quantityNum = Number(quantity);
  const quantityError = useMemo(() => {
    if (!touched.quantity && !submitAttempted) return undefined;
    if (!Number.isFinite(quantityNum) || quantityNum < 1 || quantityNum > 50) {
      return "Enter a quantity from 1 to 50.";
    }
    return undefined;
  }, [quantityNum, touched.quantity, submitAttempted]);

  const addressErrors = useMemo(() => {
    if (option !== "home") return {};
    const show = submitAttempted || touched.addressGroup;
    if (!show) return {};
    const errs: Record<string, string> = {};
    if (!address.line1.trim()) errs.line1 = "Residential/Delivery address is required.";
    return errs;
  }, [option, address, submitAttempted, touched.addressGroup]);

  function validateStep1(): boolean {
    const capOk =
      capacity === "custom"
        ? customCapacity.trim() !== "" && Number.isFinite(capacityKg) && capacityKg > 0 && capacityKg <= 100
        : Number.isFinite(capacityKg) && capacityKg > 0;
    return (
      capOk &&
      Number.isFinite(quantityNum) &&
      quantityNum >= 1 &&
      quantityNum <= 50 &&
      Boolean(capacity)
    );
  }

  function validateStep2(): boolean {
    const phoneOk = Boolean(phone.trim()) && isValidNgPhone(phone);
    if (!phoneOk) return false;
    if (option === "home") {
      return Boolean(address.line1.trim());
    }
    return true;
  }

  function goNext() {
    setError(null);
    if (step === 1) {
      markTouched("capacity");
      markTouched("quantity");
      if (!validateStep1()) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      setSubmitAttempted(true);
      markTouched("phone");
      markTouched("addressGroup");
      if (!validateStep2()) {
        setError("Please complete the required fields to continue.");
        return;
      }
      setStep(3);
    }
  }

  function goBack() {
    setError(null);
    setStep((s) => (s === 1 ? 1 : ((s - 1) as Step)));
  }

  function buildBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      type: "refill",
      contactPhone: phone.trim(),
      deliveryMethod: option,
      payload: {
        capacityKg,
        quantity: Math.round(quantityNum),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
    };
    if (option === "home") {
      body.address = {
        line1: address.line1.trim(),
        city: "-",
        state: "-",
        lga: "-",
      };
    }
    return body;
  }

  async function submit() {
    if (submitting) return;
    setError(null);
    setSubmitAttempted(true);
    if (!validateStep1() || !validateStep2()) {
      setError("Some required information is missing. Please review your details.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api<SubmitResponse>("/requests", {
        method: "POST",
        body: buildBody(),
      });
      setDone(result);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "We couldn't submit your refill request. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function copyReference() {
    if (!done?.reference) return;
    try {
      await navigator.clipboard.writeText(done.reference);
      toast({ message: "Reference copied.", tone: "success" });
    } catch {
      toast({ message: "Couldn't copy automatically. Please copy it manually.", tone: "warning" });
    }
  }

  function resetForm() {
    setStep(1);
    setCapacity("12.5");
    setCustomCapacity("");
    setQuantity("1");
    setOption("home");
    setNotes("");
    setTouched({});
    setSubmitAttempted(false);
    setSubmitting(false);
    setError(null);
    setDone(null);
    // Keep signed-in identity context, but allow saved location to be applied again if needed.
    if (user?.phone) {
      setPhone(user.phone);
      setPhonePrefilled(true);
    } else {
      setPhone("");
      setPhonePrefilled(false);
    }
    const saved = user?.profile?.defaultAddress;
    if (saved) {
      setAddress({ line1: saved.line1 ?? "" });
      setAddressPrefilled(true);
    } else {
      setAddress(EMPTY_ADDRESS);
      setAddressPrefilled(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="t-card t-card--pad">
          <div
            className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full text-xl"
            style={{ background: "var(--success-surface)", color: "var(--success)" }}
            aria-hidden="true"
          >
            ✓
          </div>
          <h1 className="text-center text-xl font-semibold tracking-tight">
            Refill request submitted
          </h1>
          <p className="mt-2 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            Your request reference is
          </p>
          <p className="mt-1 text-center font-mono text-lg font-semibold" style={{ color: "var(--text)" }}>
            {done.reference}
          </p>
          <div className="mt-3 flex justify-center">
            <Button type="button" variant="secondary" size="sm" onClick={() => void copyReference()}>
              Copy reference
            </Button>
          </div>

          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt style={{ color: "var(--text-muted)" }}>Refill option</dt>
              <dd className="mt-0.5 font-medium">
                {option === "home" ? "On-site refill" : "Station refill"}
              </dd>
            </div>
            <div>
              <dt style={{ color: "var(--text-muted)" }}>Cylinder</dt>
              <dd className="mt-0.5 font-medium">
                {capacityKg} kg × {Math.max(1, Math.round(quantityNum || 1))}
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>
            {option === "home"
              ? "Our team will come to your location to refill your cylinder. No cylinder is dispatched to you."
              : "Bring your cylinder to our station for refilling. Station details, if available, will be shared through our service updates."}
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            Save your reference — it identifies this refill request in every conversation.
          </p>

          <div
            className="mt-5 rounded-lg border p-4"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <p className="text-sm font-medium">
              {user ? "View in your account" : "Keep this reference safe"}
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {user
                ? "Because you’re signed in, this request is saved to your account. Open My requests to view status and updates anytime."
                : "Save your request reference for follow-up. If you create an account or sign in, your requests are easier to manage in one place."}
            </p>
            <div className="mt-3">
              <Link
                to={user ? "/account" : "/register"}
                className="t-btn t-btn--primary t-btn--sm"
              >
                {user ? "Open My requests" : "Create account / sign in"}
              </Link>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button type="button" variant="ghost" size="md" onClick={resetForm}>
              Submit another
            </Button>
            {user ? (
              <Link to="/account" className="t-btn t-btn--secondary t-btn--md">
                Go to My requests
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const steps = [
    { n: 1, label: "Refill details" },
    { n: 2, label: "Contact & location" },
    { n: 3, label: "Review & submit" },
  ] as const;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Request a refill</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
        Choose on-site refill (we come to you) or station refill (bring your cylinder).
        No cylinder is dispatched to you.
      </p>

      {/* Progress */}
      <ol className="mt-6 grid grid-cols-3 gap-2" aria-label="Progress">
        {steps.map((s) => {
          const active = step === s.n;
          const doneStep = step > s.n;
          return (
            <li key={s.n} className="min-w-0">
              <div
                className="rounded-lg border px-2 py-2 text-center"
                style={{
                  borderColor: active || doneStep ? "var(--primary)" : "var(--border)",
                  background: active ? "var(--primary-surface)" : "var(--surface)",
                }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: active ? "var(--primary-hover)" : "var(--text-muted)" }}>
                  Step {s.n}
                </p>
                <p className="mt-0.5 truncate text-xs font-medium" style={{ color: "var(--text)" }}>
                  {s.label}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <form
        className="mt-6 space-y-5"
        noValidate
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          if (step < 3) goNext();
          else void submit();
        }}
      >
        {step === 1 ? (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-3">
                <Select
                  label="Cylinder capacity"
                  value={capacity}
                  onChange={(e) => {
                    setCapacity(e.target.value);
                    if (e.target.value !== "custom") setCustomCapacity("");
                  }}
                  onBlur={() => markTouched("capacity")}
                  options={CAPACITIES}
                  error={capacity !== "custom" ? capacityError : undefined}
                  required
                />
                {capacity === "custom" ? (
                  <TextInput
                    label="Custom capacity (kg)"
                    type="number"
                    inputMode="decimal"
                    min={0.1}
                    max={100}
                    step="0.1"
                    value={customCapacity}
                    onChange={(e) => setCustomCapacity(e.target.value)}
                    onBlur={() => markTouched("capacity")}
                    error={capacityError}
                    placeholder="e.g. 4.5"
                    required
                  />
                ) : null}
              </div>
              <TextInput
                label="Quantity"
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                onBlur={() => markTouched("quantity")}
                error={quantityError}
                required
              />
            </div>

            <fieldset>
              <legend className="t-field__label mb-2">Refill option *</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label
                  className="t-card flex cursor-pointer items-start gap-3 p-4"
                  style={{ borderColor: option === "home" ? "var(--primary)" : "var(--border)" }}
                >
                  <input
                    type="radio"
                    name="refill-option"
                    value="home"
                    checked={option === "home"}
                    onChange={() => setOption("home")}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-semibold">On-site refill</span>
                    <span className="mt-0.5 block text-xs" style={{ color: "var(--text-muted)" }}>
                      Our team comes to your location and refills your cylinder there.
                    </span>
                  </span>
                </label>
                <label
                  className="t-card flex cursor-pointer items-start gap-3 p-4"
                  style={{ borderColor: option === "station" ? "var(--primary)" : "var(--border)" }}
                >
                  <input
                    type="radio"
                    name="refill-option"
                    value="station"
                    checked={option === "station"}
                    onChange={() => setOption("station")}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-semibold">Station refill</span>
                    <span className="mt-0.5 block text-xs" style={{ color: "var(--text-muted)" }}>
                      Bring your cylinder to our station for refilling.
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <TextInput
              label="Phone number"
              hint="We use it to confirm and update this refill request."
              placeholder="0803 123 4567"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => markTouched("phone")}
              error={phoneError}
            />

            {option === "home" ? (
              <div className="space-y-5 rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
                <div>
                  <p className="text-sm font-medium">Refill location</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {user?.profile?.defaultAddress
                      ? "Your saved service location is filled in. You can edit it if this refill is at a different location."
                      : "Tell us where the cylinder is so our team can come and refill it."}
                  </p>
                </div>
                <TextInput
                  label="Residential/Delivery address"
                  autoComplete="street-address"
                  required
                  value={address.line1}
                  onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                  onBlur={() => markTouched("addressGroup")}
                  error={addressErrors.line1}
                  placeholder="House number, street, area, landmark"
                />
              </div>
            ) : (
              <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                <p className="text-sm font-medium">Station refill</p>
                <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                  You’ll bring your cylinder to our station for refilling. If station details are available, our team will confirm them when they contact you.
                </p>
              </div>
            )}

            <TextArea
              label="Additional notes (optional)"
              hint="Anything else (e.g. preferred time, cylinder condition)."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </>
        ) : null}

        {step === 3 ? (
          <div className="t-card t-card--pad">
            <h2 className="text-base font-semibold">Review your request</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              Check the details below before submitting.
            </p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt style={{ color: "var(--text-muted)" }}>Phone number</dt>
                <dd className="mt-0.5 font-medium">{phone || "—"}</dd>
              </div>
              <div>
                <dt style={{ color: "var(--text-muted)" }}>Cylinder capacity</dt>
                <dd className="mt-0.5 font-medium">{capacityKg} kg</dd>
              </div>
              <div>
                <dt style={{ color: "var(--text-muted)" }}>Quantity</dt>
                <dd className="mt-0.5 font-medium">{Math.max(1, Math.round(quantityNum || 1))}</dd>
              </div>
              <div>
                <dt style={{ color: "var(--text-muted)" }}>Refill option</dt>
                <dd className="mt-0.5 font-medium">
                  {option === "home" ? "On-site refill (we come to you)" : "Station refill (bring to station)"}
                </dd>
              </div>
              {option === "home" ? (
                <div className="sm:col-span-2">
                  <dt style={{ color: "var(--text-muted)" }}>Residential/Delivery address</dt>
                  <dd className="mt-0.5 font-medium">{address.line1 || "—"}</dd>
                </div>
              ) : null}
              {notes.trim() ? (
                <div className="sm:col-span-2">
                  <dt style={{ color: "var(--text-muted)" }}>Additional notes</dt>
                  <dd className="mt-0.5">{notes.trim()}</dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
              Payment is confirmed before the refill is marked complete.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm" style={{ color: "var(--error)" }}>
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
          {step > 1 ? (
            <Button type="button" variant="ghost" onClick={goBack} disabled={submitting}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {step < 3 ? (
            <Button type="submit" size="lg">
              Continue
            </Button>
          ) : (
            <Button type="submit" size="lg" loading={submitting}>
              Submit refill request
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
