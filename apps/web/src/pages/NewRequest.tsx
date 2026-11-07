import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { RequestType, SubmitResponse } from "../lib/types";
import { useAuth } from "../lib/auth";
import { Button, Select, TextArea, TextInput } from "@togi/ui";

/**
 * New request — one flow for all three types (v1.2 §1.4.2).
 * Guests may submit with just a phone number; success shows the reference
 * and (for guests) the one-time tracking link. Authenticated customers get
 * their request saved to their account automatically.
 */

const CAPACITIES = [
  { value: "3", label: "3 kg" },
  { value: "6", label: "6 kg" },
  { value: "12.5", label: "12.5 kg" },
  { value: "25", label: "25 kg" },
  { value: "50", label: "50 kg" },
];

const COMPLAINT_CATEGORIES = [
  { value: "delivery", label: "Delivery issue" },
  { value: "cylinder", label: "Cylinder problem" },
  { value: "quality", label: "Gas quality / quantity" },
  { value: "billing", label: "Billing or price" },
  { value: "staff", label: "Staff conduct" },
  { value: "safety", label: "Safety concern" },
  { value: "other", label: "Something else" },
];

const TYPES: Array<{ id: RequestType; title: string; blurb: string }> = [
  { id: "refill", title: "Refill", blurb: "Order gas for collection or delivery" },
  { id: "complaint", title: "Complaint", blurb: "Tell us what went wrong" },
  { id: "enquiry", title: "Enquiry", blurb: "Ask a question" },
];

interface AddressForm {
  line1: string;
  line2: string;
  city: string;
  state: string;
  lga: string;
  deliveryNote: string;
}

const EMPTY_ADDRESS: AddressForm = {
  line1: "",
  line2: "",
  city: "",
  state: "",
  lga: "",
  deliveryNote: "",
};

export default function NewRequest() {
  const { user } = useAuth();

  const [type, setType] = useState<RequestType | null>(null);
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);

  // refill
  const [capacity, setCapacity] = useState("12.5");
  const [quantity, setQuantity] = useState("1");
  const [delivery, setDelivery] = useState<"home" | "station">("station");
  const [address, setAddress] = useState<AddressForm>(EMPTY_ADDRESS);
  const [refillNotes, setRefillNotes] = useState("");

  // complaint / enquiry
  const [category, setCategory] = useState("delivery");
  const [description, setDescription] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SubmitResponse | null>(null);

  const phoneError = useMemo(() => {
    if (!phoneTouched || phone.length === 0) return undefined;
    const digits = phone.replace(/\D/g, "");
    const ok = /^(?:\+?234|0)?[789][01]\d{8}$/.test(digits.replace(/[\s\-().]/g, ""));
    return ok ? undefined : "Enter a valid Nigerian number, e.g. 0803 123 4567";
  }, [phone, phoneTouched]);

  function buildBody(): Record<string, unknown> {
    const contactPhone = phone.trim();
    if (type === "refill") {
      const body: Record<string, unknown> = {
        type: "refill",
        contactPhone,
        deliveryMethod: delivery,
        payload: {
          capacityKg: Number(capacity),
          quantity: Number(quantity),
          ...(refillNotes.trim() ? { notes: refillNotes.trim() } : {}),
        },
      };
      if (delivery === "home") {
        body.address = {
          line1: address.line1.trim(),
          ...(address.line2.trim() ? { line2: address.line2.trim() } : {}),
          city: address.city.trim(),
          state: address.state.trim(),
          lga: address.lga.trim(),
          ...(address.deliveryNote.trim() ? { deliveryNote: address.deliveryNote.trim() } : {}),
        };
      }
      return body;
    }
    if (type === "complaint") {
      return {
        type: "complaint",
        contactPhone,
        payload: { category, description: description.trim() },
      };
    }
    return {
      type: "enquiry",
      contactPhone,
      payload: { subject: subject.trim(), message: message.trim() },
    };
  }

  function validate(): string | null {
    if (!type) return "Choose what you need.";
    if (!phone.trim()) return "Enter your phone number so we can reach you.";
    if (phoneError) return phoneError;
    if (type === "refill") {
      if (delivery === "home") {
        if (!address.line1.trim() || !address.city.trim() || !address.state.trim() || !address.lga.trim()) {
          return "Complete the delivery address (street, city, state, LGA).";
        }
      }
    }
    if (type === "complaint" && description.trim().length < 10) {
      return "Describe the complaint in at least a couple of sentences.";
    }
    if (type === "enquiry" && (subject.trim().length < 3 || message.trim().length < 5)) {
      return "Add a subject and a short message.";
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    try {
      const result = await api<SubmitResponse>("/requests", { method: "POST", body: buildBody() });
      setDone(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success screen ─────────────────────────────────────────────
  if (done) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="t-card t-card--pad text-center">
          <div
            className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full text-xl"
            style={{ background: "var(--success-surface)", color: "var(--success)" }}
            aria-hidden="true"
          >
            ✓
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Request received</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            Your reference is{" "}
            <strong className="font-mono" style={{ color: "var(--text)" }}>
              {done.reference}
            </strong>
            . Save it — it's how we identify your request in every conversation.
          </p>

          {done.trackingPath ? (
            <div
              className="mt-5 rounded-lg border p-4 text-left"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <p className="text-sm font-medium">Your private tracking link</p>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                {done.message}
              </p>
              <Link to={done.trackingPath} className="t-btn t-btn--secondary t-btn--sm mt-3">
                Track this request
              </Link>
            </div>
          ) : null}

          <div className="mt-6 flex justify-center gap-3">
            <Link to="/request" className="t-btn t-btn--ghost t-btn--md">
              Submit another
            </Link>
            <Link to={user ? "/account" : "/"} className="t-btn t-btn--primary t-btn--md">
              {user ? "View my requests" : "Done"}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">How can we help?</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
        One form for refills, complaints and enquiries.{" "}
        {user ? "You're signed in — this will be saved to your account." : "No account needed."}
      </p>

      {/* Type picker */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Request type">
        {TYPES.map((t) => {
          const active = type === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setType(t.id)}
              className="t-card t-lift p-4 text-left"
              style={{
                borderColor: active ? "var(--primary)" : "var(--border)",
                boxShadow: active
                  ? "0 0 0 1px var(--primary), 0 8px 20px color-mix(in srgb, var(--primary) 16%, transparent)"
                  : "var(--shadow-sm)",
                background: active ? "var(--primary-surface)" : "var(--surface-raised)",
              }}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{t.title}</span>
                {active ? (
                  <span
                    className="grid h-4.5 w-4.5 place-items-center rounded-full text-[10px] font-bold"
                    style={{
                      background: "var(--primary)",
                      color: "var(--primary-contrast)",
                      width: "1.125rem",
                      height: "1.125rem",
                    }}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                ) : null}
              </span>
              <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>
                {t.blurb}
              </span>
            </button>
          );
        })}
      </div>

      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <TextInput
          label="Your phone number"
          hint="We use it for updates about this request only."
          placeholder="0803 123 4567"
          inputMode="tel"
          autoComplete="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => setPhoneTouched(true)}
          error={phoneError}
        />

        {type === "refill" ? (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Select
                label="Cylinder size"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                options={CAPACITIES}
              />
              <TextInput
                label="Quantity"
                type="number"
                min={1}
                max={50}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>

            <fieldset>
              <legend className="t-field__label mb-2">How do you want it?</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["station", "home"] as const).map((m) => (
                  <label
                    key={m}
                    className="t-card flex cursor-pointer items-start gap-3 p-4"
                    style={{ borderColor: delivery === m ? "var(--primary)" : "var(--border)" }}
                  >
                    <input
                      type="radio"
                      name="delivery"
                      value={m}
                      checked={delivery === m}
                      onChange={() => setDelivery(m)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-semibold">
                        {m === "home" ? "Home delivery" : "Station pick-up"}
                      </span>
                      <span className="mt-0.5 block text-xs" style={{ color: "var(--text-muted)" }}>
                        {m === "home"
                          ? "We bring it to your address"
                          : "Collect from our drop-off point"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {delivery === "home" ? (
              <div className="space-y-5 rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
                <p className="text-sm font-medium">Delivery address</p>
                <TextInput
                  label="Street address"
                  autoComplete="address-line1"
                  required
                  value={address.line1}
                  onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                />
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextInput
                    label="Landmark / line 2 (optional)"
                    value={address.line2}
                    onChange={(e) => setAddress({ ...address, line2: e.target.value })}
                  />
                  <TextInput
                    label="City / town"
                    autoComplete="address-level2"
                    required
                    value={address.city}
                    onChange={(e) => setAddress({ ...address, city: e.target.value })}
                  />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextInput
                    label="State"
                    autoComplete="address-level1"
                    required
                    value={address.state}
                    onChange={(e) => setAddress({ ...address, state: e.target.value })}
                  />
                  <TextInput
                    label="LGA"
                    required
                    value={address.lga}
                    onChange={(e) => setAddress({ ...address, lga: e.target.value })}
                  />
                </div>
                <TextArea
                  label="Delivery instructions (optional)"
                  hint="Gate codes, best hours, how to find you."
                  value={address.deliveryNote}
                  onChange={(e) => setAddress({ ...address, deliveryNote: e.target.value })}
                />
              </div>
            ) : null}

            <TextArea
              label="Notes (optional)"
              hint="Anything our team should know before dispatch."
              value={refillNotes}
              onChange={(e) => setRefillNotes(e.target.value)}
            />
          </>
        ) : null}

        {type === "complaint" ? (
          <>
            <Select
              label="What is it about?"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={COMPLAINT_CATEGORIES}
            />
            <TextArea
              label="What happened?"
              hint="Include dates, references or order numbers if you have them."
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              error={
                description.length > 0 && description.trim().length < 10
                  ? "Please add a little more detail."
                  : undefined
              }
            />
          </>
        ) : null}

        {type === "enquiry" ? (
          <>
            <TextInput
              label="Subject"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <TextArea
              label="Your question"
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm" style={{ color: "var(--error)" }}>
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-4 pt-1">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {type === "refill" ? "Handling questions? See Safety information." : ""}
          </p>
          <Button type="submit" size="lg" loading={submitting} disabled={!type}>
            {type ? `Submit ${type}` : "Choose a request type"}
          </Button>
        </div>
      </form>
    </div>
  );
}
