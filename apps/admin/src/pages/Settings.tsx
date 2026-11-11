import { Card } from "@togi/ui";
import { useAuth } from "../lib/auth";

/**
 * Settings — the operator's own account plus the business configuration that
 * is deliberately deferred until launch (v1.2 §1.1 / §13): price list, zones,
 * emergency numbers and the SMS provider are supplied by the business, not
 * invented here. Each item states plainly what is pending, so the console
 * never pretends to configure something that has no server-side source yet.
 */

const PENDING = [
  {
    title: "Price list",
    body: "Cylinder sizes and per-zone prices are pending the approved price list. Requests currently carry an estimate only.",
  },
  {
    title: "Delivery zones",
    body: "Zone names and LGA coverage are pending business sign-off; the schema and address capture are already in place.",
  },
  {
    title: "Emergency numbers",
    body: "The emergency line shown on the safety page is a placeholder pending the confirmed number.",
  },
  {
    title: "SMS provider",
    body: "OTP delivery runs on the development adapter until an SMS provider is contracted (deferred per the approved plan).",
  },
];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
      <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
        {label}
      </dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export default function Settings() {
  const { user, logout } = useAuth();

  return (
    <div className="mx-auto max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Your staff account and the console&apos;s launch configuration.
        </p>
      </div>

      <Card className="mt-6" padded title="Your account">
        <dl className="divide-y divide-[var(--border)]">
          <Row label="Name" value={user?.fullName ?? "—"} />
          <Row label="Email" value={user?.email ?? "—"} />
          <Row label="Phone" value={user?.phone ?? "—"} />
          <Row label="Department" value={user?.department ?? "—"} />
          <Row label="Roles" value={user?.roles.length ? user.roles.join(", ") : "—"} />
          <Row label="Two-factor" value={user?.totpEnrolled ? "Enabled (TOTP)" : "Not set up"} />
        </dl>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void logout()}
            className="text-sm font-medium underline underline-offset-4"
            style={{ color: "var(--accent-text)" }}
          >
            Sign out of this device
          </button>
        </div>
      </Card>

      <Card className="mt-5" padded title="Business configuration">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          These values come from the business and are intentionally not editable here yet.
          Each is marked with what is outstanding.
        </p>
        <ul className="mt-4 space-y-4">
          {PENDING.map((item) => (
            <li key={item.title} className="border-l-2 pl-3" style={{ borderColor: "var(--border-strong)" }}>
              <p className="text-sm font-medium">
                {item.title}{" "}
                <span className="ml-1 text-xs font-normal" style={{ color: "var(--accent-text)" }}>
                  Pending
                </span>
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                {item.body}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-5" padded title="Security">
        <ul className="list-disc space-y-2 pl-5 text-sm" style={{ color: "var(--text-muted)" }}>
          <li>Staff sessions are audience-scoped — a customer session can never open this console.</li>
          <li>Every state-changing call is origin-checked and double-submit CSRF protected.</li>
          <li>Claim decisions, status moves and notes are recorded in an append-only audit trail.</li>
        </ul>
      </Card>
    </div>
  );
}
